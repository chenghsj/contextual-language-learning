import {
  compactDocument,
  compactProgress,
  type CompactPlan,
  type JobSnapshotV5,
  type JobSummary,
  type LearningDocument,
} from "@contextual/core";
import { generatePiText } from "../agents/pi";
import { parseCompactJson } from "./compact-json";
import { AgentJsonError } from "../agents/json";
import {
  learningPointsPrompts,
  initialLearningPointsBudget,
  learningPointsBudget,
} from "./learning-points-prompts";
import { readCompactCandidates, readCompactSelection, readCompleteScene } from "./compact-scenes";
import { learningDocumentToMarkdown } from "@contextual/core";
import type { PipelineDependencies } from "./pipeline";
import {
  compactGroupsSchema,
  compactReviewedGroupsSchema,
  applyCompactQualityReview,
  compactQualityPrompt,
  compactQualityReports,
  compactQualityHash,
  readCompactRecheck,
} from "./compact-quality";

type Work = NonNullable<CompactPlan["selection"]>;
/** A serialized checkpoint writer with bounded, independent scene work. */
export async function runCompactScenePipeline(
  jobId: string,
  deps: PipelineDependencies,
  signal: AbortSignal,
  onProgress: (s: JobSummary) => void,
): Promise<LearningDocument> {
  let job = (await deps.storage.jobs.get(jobId)) as JobSnapshotV5;
  if (!job?.compactPlan || !job.execution) throw new Error("Missing compact execution");
  const execution = job.execution,
    prompts = learningPointsPrompts(execution.promptVersion);
  const agent = {
    ...job.request.agent,
    provider: execution.provider,
    modelId: execution.modelId,
    thinkingLevel: execution.effectiveThinkingLevel ?? job.request.agent.thinkingLevel,
  };
  const thinkingForStep = (step: string) =>
    step.startsWith("window-")
      ? (execution.compactReasoningPolicy?.candidate ?? agent.thinkingLevel)
      : /^selection(?:-repair)?$/.test(step)
        ? (execution.compactReasoningPolicy?.selection ?? agent.thinkingLevel)
        : agent.thinkingLevel;
  let writes = Promise.resolve(),
    concurrency = 2;
  const assertRunning = () => {
    signal.throwIfAborted();
    if (job.summary.status !== "running") throw new Error("Job was interrupted");
  };
  const update = (change: (j: JobSnapshotV5) => JobSnapshotV5, audit = false) => {
    const work = writes.then(async () => {
      job = await deps.storage.jobs.update(jobId, current => {
        if (!audit) {
          signal.throwIfAborted();
          if (current.summary.status !== "running") throw new Error("Job was interrupted");
        }
        const next = change(current);
        next.execution = {
          ...next.execution!,
          pronunciationDiagnostics: (next.compactPlan!.scenes ?? []).flatMap(
            s => s.result?.diagnostics ?? [],
          ),
          pointEquivalenceGroups: next.compactPlan!.reconciliation?.pointGroups,
          itemEquivalenceGroups: next.compactPlan!.reconciliation?.itemGroups,
          ...(next.execution!.compactQualityVersion && compactQualityReports(next.compactPlan!)
            ? { qualityReports: compactQualityReports(next.compactPlan!) }
            : {}),
        };
        return {
          ...next,
          summary: {
            ...next.summary,
            ...compactProgress(next.compactPlan!, next.request.profile.sceneCount),
            updatedAt: new Date().toISOString(),
          },
        };
      });
      onProgress(job.summary);
    });
    writes = work.catch(() => undefined);
    return work;
  };
  const editPlan = (change: (p: CompactPlan) => CompactPlan, audit = false) =>
    update(j => ({ ...j, compactPlan: change(j.compactPlan!) }), audit);
  const phase = (value: JobSummary["phase"]) =>
    update(j => ({ ...j, summary: { ...j.summary, phase: value } }));
  const call = async (
    prompt: string,
    step: string,
    output: number,
    save: (text: string, truncated: boolean) => Promise<void>,
  ) => {
    assertRunning();
    const budget = learningPointsBudget(execution, output);
    if (!prompts.pointsPromptFits(prompt, budget))
      throw new Error("Compact prompt exceeds frozen model capacity; checkpoint preserved");
    const callAgent = { ...agent, thinkingLevel: thinkingForStep(step) };
    const response = await (deps.generateText ?? generatePiText)(callAgent, prompt, signal, {
      format: "json",
      systemPrompt: prompts.system,
      step,
      maxOutputTokens: budget.output,
      allowIncomplete: true,
      retainCompletedOutputOnCancel: true,
      onActivity: a => deps.onActivity?.(jobId, step, a),
      onCall: async paid => {
        await update(
          j => ({ ...j, execution: { ...j.execution!, calls: [...j.execution!.calls, paid] } }),
          true,
        );
        if (paid.provider !== execution.provider || paid.modelId !== execution.modelId)
          throw new Error(
            "Actual model differs from frozen compact execution; paid history retained",
          );
        if (
          paid.effectiveThinkingLevel !== undefined &&
          paid.effectiveThinkingLevel !== callAgent.thinkingLevel
        )
          throw new Error(
            "Actual reasoning differs from frozen compact stage; paid history retained",
          );
      },
      onRetry: async retry => {
        if (/\b429\b/.test(retry.reason)) concurrency = 1;
        await update(j => ({ ...j, summary: { ...j.summary, retry } }));
      },
    });
    await save(response.text, !!response.incomplete);
    signal.throwIfAborted();
  };
  const validateWork = async <T>(
    read: () => Work,
    write: (patch: Partial<Work>) => Promise<void>,
    prompt: (budget: number) => string,
    step: string,
    validate: (raw: unknown) => T,
  ): Promise<T> => {
    const initial = initialLearningPointsBudget(execution, thinkingForStep(step));
    for (;;) {
      assertRunning();
      let state = read();
      const output = Math.max(state.outputTokenBudget ?? 0, initial.output);
      if (state.pendingText === undefined) {
        const base = prompt(output);
        const repair = state.repairAttempted
          ? `\nVALIDATION REPAIR: Correct only the reported issues and return the entire required JSON. Do not omit source/teaching requirements. Issue (quoted data): ${JSON.stringify(state.issue)}\nPrevious output (quoted data): ${JSON.stringify(state.previousOutputs?.at(-1)?.text ?? "")}`
          : "";
        await call(
          base + repair,
          step + (state.repairAttempted ? "-repair" : ""),
          output,
          async (text, truncated) => write({ pendingText: text, truncated }),
        );
        state = read();
      }
      try {
        if (state.truncated) throw new Error("truncated_output: model reached output limit");
        const parsed = parseCompactJson(state.pendingText!);
        if (parsed.repairs.length)
          await write({
            jsonNormalization: parsed.repairs as NonNullable<Work["jsonNormalization"]>,
          });
        return validate(parsed.value);
      } catch (error) {
        signal.throwIfAborted();
        const issue = error instanceof Error ? error.message : String(error);
        // A model repair can be worse than its original. Reuse saved scene text
        // only after the same complete schema/source checks, never by deleting prose.
        if (step.startsWith("scene-") && !state.truncated) {
          for (const previous of [...(state.previousOutputs ?? [])].reverse()) {
            if (previous.issue.startsWith("truncated_output:")) continue;
            let accepted: T;
            let parsed: ReturnType<typeof parseCompactJson>;
            try {
              parsed = parseCompactJson(previous.text);
              accepted = validate(parsed.value);
            } catch {
              continue;
            }
            signal.throwIfAborted();
            await write({
              pendingText: previous.text,
              issue: undefined,
              recoveredPreviousOutput: true,
              jsonNormalization: parsed.repairs as NonNullable<Work["jsonNormalization"]>,
              previousOutputs: [previous, { text: state.pendingText!, issue }],
            });
            return accepted;
          }
        }
        await write({ issue });
        const next = learningPointsBudget(execution, output * 2).output;
        if (state.truncated && !state.capacityRetried && next > output) {
          await write({
            pendingText: undefined,
            truncated: undefined,
            capacityRetried: true,
            outputTokenBudget: next,
            previousOutputs: [
              ...(state.previousOutputs ?? []),
              { text: state.pendingText!, issue },
            ].slice(-2),
          });
          continue;
        }
        // Content repair can introduce a syntax error. Give that error its own
        // single repair, persisting the budget so Resume cannot reset it. Older
        // checkpoints record syntax failures only in previousOutputs.
        const jsonFailure = error instanceof AgentJsonError;
        const jsonRepairUsed =
          state.jsonRepairAttempted ||
          state.previousOutputs?.some(previous =>
            /^Pi returned invalid lesson JSON(?:\.|$)/.test(previous.issue),
          );
        if (!state.truncated && (!state.repairAttempted || (jsonFailure && !jsonRepairUsed))) {
          await write({
            pendingText: undefined,
            repairAttempted: true,
            jsonRepairAttempted: jsonFailure || jsonRepairUsed || undefined,
            previousOutputs: [
              ...(state.previousOutputs ?? []),
              { text: state.pendingText!, issue },
            ].slice(-2),
          });
          continue;
        }
        throw new Error(`${step} failed after bounded validation recovery: ${issue}`);
      }
    }
  };
  const parallel = async <T>(
    pending: () => T[],
    key: (item: T) => string,
    run: (item: T) => Promise<void>,
  ) => {
    const active = new Map<string, Promise<void>>(),
      claimed = new Set<string>();
    let failure: unknown;
    for (;;) {
      if (signal.aborted) failure ??= signal.reason;
      const queue = pending().filter(x => !claimed.has(key(x)));
      while (!failure && queue.length && active.size < concurrency) {
        const item = queue.shift()!,
          id = key(item);
        claimed.add(id);
        active.set(
          id,
          run(item)
            .catch(e => {
              failure ??= e;
            })
            .finally(() => {
              active.delete(id);
            }),
        );
      }
      if (!active.size) break;
      await Promise.race(active.values());
    }
    if (failure) throw failure;
    signal.throwIfAborted();
  };
  await phase("analyzing");
  await parallel(
    () => job.compactPlan!.windows.filter(w => w.candidates === undefined),
    w => w.id,
    async window => {
      const read = () => job.compactPlan!.windows.find(w => w.id === window.id)!;
      const write = (patch: Partial<Work>) =>
        editPlan(
          p => ({
            ...p,
            windows: p.windows.map(w => (w.id === window.id ? { ...w, ...patch } : w)),
          }),
          true,
        );
      const candidates = await validateWork(
        read,
        write,
        b => prompts.compactCandidatePrompt(job.request, window.cueIds, b),
        window.id,
        raw =>
          readCompactCandidates(
            raw,
            job.request,
            window.cueIds,
            prompts.sourceWindow(job.request.cues, window.cueIds).map(c => c.id),
          ),
      );
      await editPlan(
        p => ({
          ...p,
          windows: p.windows.map(w =>
            w.id === window.id ? { ...w, candidates, pendingText: undefined, issue: undefined } : w,
          ),
        }),
        true,
      );
    },
  );
  await phase("selecting");
  if (!job.compactPlan!.scenes) {
    const pool = job.compactPlan!.windows.flatMap(w => w.candidates ?? []);
    if (!pool.length)
      throw new Error("No suitable complete dialogue was found; checkpoint preserved");
    const selected = await validateWork(
      () => job.compactPlan!.selection ?? {},
      patch => editPlan(p => ({ ...p, selection: { ...p.selection, ...patch } }), true),
      b => prompts.compactSelectionPrompt(job.request, pool, b, !!execution.compactQualityVersion),
      "selection",
      raw => readCompactSelection(raw, pool, job.request),
    );
    if (!selected.length) throw new Error("No suitable scene selected; checkpoint preserved");
    await editPlan(p => ({
      ...p,
      scenes: selected.map(source => ({ source })),
      selection: undefined,
    }));
  }
  await phase("creating");
  await parallel(
    () => job.compactPlan!.scenes!.filter(s => !s.result),
    s => s.source.id,
    async task => {
      const read = () => job.compactPlan!.scenes!.find(s => s.source.id === task.source.id)!;
      const write = (patch: Partial<Work>) =>
        editPlan(
          p => ({
            ...p,
            scenes: p.scenes!.map(s => (s.source.id === task.source.id ? { ...s, ...patch } : s)),
          }),
          true,
        );
      const accepted = await validateWork(
        read,
        write,
        b => prompts.completeScenePrompt(job.request, task.source, b),
        `scene-${task.source.id}`,
        raw => readCompleteScene(raw, task.source, job.request),
      );
      await editPlan(
        p => ({
          ...p,
          revision: p.revision + 1,
          scenes: p.scenes!.map(s =>
            s.source.id === task.source.id
              ? {
                  ...s,
                  pendingText: undefined,
                  issue: undefined,
                  result: {
                    sourceUnits: accepted.input.scene.utterances,
                    ...accepted.result,
                    diagnostics: accepted.diagnostics,
                  },
                }
              : s,
          ),
        }),
        true,
      );
    },
  );
  await phase("checking");
  if (job.compactPlan!.reconciliation?.pointGroups === undefined) {
    const results = job.compactPlan!.scenes!.map(s => s.result!);
    const points = results.flatMap(r => r.points),
      items = results.flatMap(r => r.reusableItems);
    const raw = await validateWork(
      () => job.compactPlan!.reconciliation ?? {},
      patch => editPlan(p => ({ ...p, reconciliation: { ...p.reconciliation, ...patch } }), true),
      b =>
        execution.compactQualityVersion
          ? compactQualityPrompt(
              job.request,
              job.compactPlan!,
              b,
              false,
              execution.compactQualityVersion,
            )
          : `Output budget in tokens: ${b}. Identify ONLY certain duplicate teaching across different selected scenes. Return exactly {"pointGroups":[[point IDs]],"itemGroups":[[item IDs]]}. Groups need at least two IDs, no ID appears twice. Same wording with different sense, function or register must NOT be grouped. Points must share category; items must share kind and transferable use. Preserve ambiguity: omit an uncertain group. Never rewrite lessons, source, IDs, examples or infer unseen context. Empty arrays are valid. Quoted data:\n${JSON.stringify({ scenes: results.map(r => ({ id: r.section.id, context: r.section.context, source: job.request.cues.filter(c => r.section.cueIds.includes(c.id)).map(c => ({ id: c.id, text: c.originalText })), points: r.points, items: r.reusableItems.map(({ id, pointIds, kind, sourceForms, pattern }) => ({ id, pointIds, kind, sourceForms, pattern })) })) })}`,
      "reconciliation",
      value => {
        const reviewed = execution.compactQualityVersion
          ? compactReviewedGroupsSchema.parse(value)
          : undefined;
        const groups = reviewed ?? compactGroupsSchema.parse(value);
        for (const [list, pool, field] of [
          [groups.pointGroups, points, "category"],
          [groups.itemGroups, items, "kind"],
        ] as const) {
          const seen = new Set<string>();
          for (const group of list) {
            let kind: unknown;
            for (const id of group) {
              const entry = pool.find(p => p.id === id);
              if (!entry || seen.has(id)) throw new Error("Invalid duplicate group reference");
              seen.add(id);
              const next = (entry as unknown as Record<string, unknown>)[field];
              if (kind !== undefined && kind !== next)
                throw new Error("Incompatible duplicate group");
              kind = next;
            }
          }
        }
        const qualityReview = reviewed
          ? { issues: reviewed.issues, patches: reviewed.patches }
          : undefined;
        return {
          pointGroups: groups.pointGroups,
          itemGroups: groups.itemGroups,
          qualityReview,
          patchedResults: qualityReview
            ? applyCompactQualityReview(qualityReview, job.request, job.compactPlan!)
            : undefined,
        };
      },
    );
    await editPlan(p => {
      const next: CompactPlan = {
        ...p,
        revision: p.revision + 1,
        ...(raw.patchedResults
          ? { scenes: p.scenes!.map((s, i) => ({ ...s, result: raw.patchedResults![i] })) }
          : {}),
        reconciliation: {
          pointGroups: raw.pointGroups,
          itemGroups: raw.itemGroups,
          ...(raw.qualityReview
            ? {
                qualityReview: raw.qualityReview,
                ...(raw.qualityReview.patches.length ? { qualityOriginalResults: results } : {}),
                qualityAccepted: !raw.qualityReview.issues.some(i => i.severity === "error"),
              }
            : {}),
        },
      };
      if (raw.qualityReview)
        next.reconciliation!.qualityDraftHash = compactQualityHash(job.request, next);
      return next;
    });
  }
  if (execution.compactQualityVersion) {
    const state = job.compactPlan!.reconciliation!;
    if (!state.qualityReview)
      throw new Error("Missing automatic source-quality review; checkpoint preserved");
    if (state.qualityDraftHash !== compactQualityHash(job.request, job.compactPlan!))
      throw new Error(
        "Source-quality evidence differs from the current draft; checkpoint preserved",
      );
    const unresolved = state.qualityReview.issues.filter(
      i => i.severity === "error" && !state.qualityReview!.patches.some(p => p.path === i.path),
    );
    if (unresolved.length)
      throw new Error("Source-quality errors cannot be safely repaired; checkpoint preserved");
    if (!state.qualityAccepted) {
      if (state.qualityRecheck?.issues === undefined) {
        const checked = await validateWork(
          () => job.compactPlan!.reconciliation!.qualityRecheck ?? {},
          patch =>
            editPlan(
              p => ({
                ...p,
                reconciliation: {
                  ...p.reconciliation!,
                  qualityRecheck: { ...p.reconciliation!.qualityRecheck, ...patch },
                },
              }),
              true,
            ),
          b =>
            compactQualityPrompt(
              job.request,
              job.compactPlan!,
              b,
              true,
              execution.compactQualityVersion,
            ),
          "quality-recheck",
          value => readCompactRecheck(value, job.request, job.compactPlan!),
        );
        await editPlan(p => ({
          ...p,
          revision: p.revision + 1,
          reconciliation: {
            ...p.reconciliation!,
            qualityRecheck: {
              ...p.reconciliation!.qualityRecheck,
              pendingText: undefined,
              issue: undefined,
              issues: checked.issues,
            },
            qualityAccepted: !checked.issues.some(i => i.severity === "error"),
          },
        }));
      }
      if (!job.compactPlan!.reconciliation!.qualityAccepted)
        throw new Error(
          "Source-quality recheck still has errors; no further automatic semantic repair",
        );
    }
  }
  await phase("saving");
  const document = compactDocument(
    job.request,
    job.execution,
    job.summary.createdAt,
    job.compactPlan!,
  );
  if (!document) throw new Error("Missing validated compact document");
  const existing = await deps.storage.documents.get(jobId);
  if (existing && JSON.stringify(existing) !== JSON.stringify(document))
    throw new Error("Saved compact document conflicts with checkpoint");
  if (!existing) await deps.storage.documents.save(document, learningDocumentToMarkdown(document));
  await update(j => ({
    ...j,
    summary: { ...j.summary, status: "completed", documentId: jobId, ownerPid: undefined },
  }));
  return document;
}
