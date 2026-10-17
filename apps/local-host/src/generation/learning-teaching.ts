import { z } from "zod";
import {
  atomicUnitGroups,
  assertAtomicUnitSplit,
  exactIds,
  TeachingSplitSchema,
  TeachingBlockedSchema,
  prepareTeachingBatch,
  validateTeachingBatch,
  type PronunciationDiagnostic,
  type TeachingInput,
} from "@contextual/core";
import { learningPointsBudget } from "./learning-points-prompts";
import { ModelRequestError, isTruncatedOutput, type LearningExecution } from "./learning-execution";

/** Execute atomic teaching groups and retain received valid output across cancellation. */
export async function teachBatches(execution: LearningExecution): Promise<void> {
  const { update, generate, signal, budget, capacity } = execution;
  const { pointsTeachingPrompt, pointsPromptFits } = execution.prompts;
  await update(j => ({ ...j, summary: { ...j.summary, phase: "creating" } }));
  for (let index = 0; index < execution.job.learningPlan.batches.length;) {
    const batch = execution.job.learningPlan.batches[index];
    if (batch.result) {
      index++;
      continue;
    }
    const scene = execution.job.learningPlan.selected!.find(s => s.id === batch.sceneId)!;
    const results = execution.job.learningPlan.batches.flatMap(b => (b.result ? [b.result] : []));
    const evidence = new Set([...scene.dialogueCueIds, ...scene.contextCueIds]);
    const input: TeachingInput = {
      scene,
      requiredUtteranceIds: batch.utteranceIds,
      sourceWindow: execution.job.request.cues.filter(c => evidence.has(c.id)),
      existingPoints: results.flatMap(r => r.points),
      existingReusableItems: results.flatMap(r => r.reusableItems),
    };
    const indivisible =
      atomicUnitGroups(scene.utterances.filter(u => batch.utteranceIds.includes(u.id))).length ===
      1;
    const previousCall = [...(execution.job.execution?.calls ?? [])]
      .reverse()
      .find(c => [batch.id, `${batch.id}-repair`].includes(c.step.replace(/-output-\d+$/, "")));
    const previousBudget =
      batch.lastIssue?.outputTokenBudget ??
      previousCall?.outputTokenBudget ??
      Number(/-output-(\d+)$/.exec(previousCall?.step ?? "")?.[1] ?? 8192);
    const lastIssue =
      batch.lastIssue?.code === "validation_error" &&
      batch.lastIssue.description.includes("invalid lesson JSON") &&
      (previousCall?.usage?.output ?? 0) >= previousBudget * 0.98
        ? {
            ...batch.lastIssue,
            code: "truncated_output" as const,
            outputTokenBudget: previousBudget,
          }
        : batch.lastIssue;
    let batchBudget = learningPointsBudget(capacity, batch.outputTokenBudget ?? budget.output);
    const expandOutputBudget = async (repair?: Parameters<typeof pointsTeachingPrompt>[3]) => {
      const next = learningPointsBudget(capacity, batchBudget.output * 2);
      if (
        next.output <= batchBudget.output ||
        !pointsPromptFits(
          pointsTeachingPrompt(execution.job.request, input, next.output, repair),
          next,
        )
      )
        return false;
      await update(j => ({
        ...j,
        learningPlan: {
          ...j.learningPlan,
          batches: j.learningPlan.batches.map(b =>
            b.id === batch.id ? { ...b, outputTokenBudget: next.output } : b,
          ),
        },
      }));
      batchBudget = next;
      return true;
    };
    // Existing failed checkpoints did not store a retry budget; resume them above 8192.
    // A budget already reserved before interruption is used once, rather than doubled again.
    if (
      indivisible &&
      !batch.pendingPronunciation &&
      lastIssue?.code === "truncated_output" &&
      batchBudget.output <= (lastIssue.outputTokenBudget ?? budget.output)
    )
      await expandOutputBudget({ previousOutput: null, issues: [lastIssue] });
    const split = async (groups: string[][]) => {
      if (groups.length < 2 || groups.some(g => !g.length || g.length >= batch.utteranceIds.length))
        throw new Error("Teaching split makes no progress");
      exactIds(
        groups.flat(),
        batch.utteranceIds,
        "Teaching split must partition all assigned utterances in order",
      );
      assertAtomicUnitSplit(groups, scene.utterances);
      await update(j => ({
        ...j,
        learningPlan: {
          ...j.learningPlan,
          batches: j.learningPlan.batches.flatMap((b, i) =>
            i === index
              ? groups.map((utteranceIds, k) => ({
                  id: b.id + "-" + k,
                  sceneId: b.sceneId,
                  utteranceIds,
                }))
              : [b],
          ),
        },
      }));
    };
    if (lastIssue?.code === "truncated_output" && !indivisible && !batch.pendingPronunciation) {
      const groups = atomicUnitGroups(
        scene.utterances.filter(u => batch.utteranceIds.includes(u.id)),
      );
      if (groups.length < 2)
        throw new Error("shared_source_group_exceeds_budget: checkpoint preserved");
      const half = Math.floor(groups.length / 2);
      await split([groups.slice(0, half).flat(), groups.slice(half).flat()]);
      continue;
    }
    let raw: unknown, error: unknown, result: ReturnType<typeof validateTeachingBatch> | undefined;
    const prompt = pointsTeachingPrompt(execution.job.request, input, batchBudget.output);
    if (!pointsPromptFits(prompt, batchBudget)) {
      if (indivisible)
        throw new Error(
          `${batch.utteranceIds.length === 1 ? "single_utterance" : "shared_source_group"}_exceeds_budget: full evidence cannot fit; checkpoint preserved`,
        );
      const groups = atomicUnitGroups(
        scene.utterances.filter(u => batch.utteranceIds.includes(u.id)),
      );
      if (groups.length < 2)
        throw new Error("shared_source_group_exceeds_budget: checkpoint preserved");
      const half = Math.floor(groups.length / 2);
      await split([groups.slice(0, half).flat(), groups.slice(half).flat()]);
      continue;
    }
    const namespace = scene.id + ":" + batch.id;
    let completedDiagnostics: PronunciationDiagnostic[] =
      batch.pendingTeaching?.diagnostics ?? batch.draftPronunciationDiagnostics ?? [];
    const processReadings = async (
      draft: unknown,
      pending = batch.pendingTeaching ?? batch.pendingPronunciation,
    ) => {
      const prepared = prepareTeachingBatch(
        draft,
        input,
        execution.job.request.profile,
        namespace,
        batch.id,
      );
      const omitted = new Set(prepared.targets.map(t => t.path));
      const diagnostics = [...(pending?.diagnostics ?? []), ...prepared.diagnostics].map(d => ({
        ...d,
        action:
          d.action === "normalized"
            ? d.action
            : omitted.has(d.path) || d.action === "pending"
              ? ("omitted" as const)
              : d.action,
      }));
      completedDiagnostics = [...new Map(diagnostics.map(d => [d.id, d])).values()];
      raw = prepared.safeOutput;
      const validated = validateTeachingBatch(raw, input, execution.job.request.profile, namespace);
      // Retain received, valid teaching even if cancellation races the final commit.
      await update(
        j => ({
          ...j,
          learningPlan: {
            ...j.learningPlan,
            batches: j.learningPlan.batches.map(b =>
              b.id === batch.id
                ? {
                    ...b,
                    pendingTeaching: {
                      draft: prepared.safeOutput,
                      diagnostics: completedDiagnostics,
                    },
                  }
                : b,
            ),
          },
        }),
        true,
      );
      signal.throwIfAborted();
      return validated;
    };
    if (batch.pendingTeaching || batch.pendingPronunciation) {
      result = await processReadings((batch.pendingTeaching ?? batch.pendingPronunciation)!.draft);
    } else {
      const canRepair = !batch.repairAttempted;
      for (let attempt = 0; attempt < (canRepair ? 2 : 1); attempt++) {
        try {
          const issue = attempt
            ? {
                code: isTruncatedOutput(error)
                  ? ("truncated_output" as const)
                  : ("validation_error" as const),
                path: "batch",
                description: String(error),
              }
            : lastIssue;
          const repair = issue
            ? { previousOutput: attempt ? (raw ?? null) : null, issues: [issue] }
            : undefined;
          for (;;) {
            try {
              raw = await generate(
                pointsTeachingPrompt(execution.job.request, input, batchBudget.output, repair),
                `${batch.id}${attempt ? "-repair" : ""}`,
                "teaching",
                batchBudget,
              );
              break;
            } catch (e) {
              if (signal.aborted || !isTruncatedOutput(e) || !indivisible) throw e;
              await update(j => ({
                ...j,
                learningPlan: {
                  ...j.learningPlan,
                  batches: j.learningPlan.batches.map(b =>
                    b.id === batch.id
                      ? {
                          ...b,
                          lastIssue: {
                            code: "truncated_output",
                            path: "batch",
                            description: String(e).slice(0, 12000),
                            outputTokenBudget: batchBudget.output,
                          },
                        }
                      : b,
                  ),
                },
              }));
              if (!(await expandOutputBudget(repair))) throw e;
            }
          }
          if (
            TeachingSplitSchema.safeParse(raw).success ||
            TeachingBlockedSchema.safeParse(raw).success
          )
            break;
          result = await processReadings(raw, undefined);
          break;
        } catch (e) {
          if (signal.aborted) throw e;
          if (e instanceof ModelRequestError) throw e;
          error = e;
          const lastIssue = {
            code: isTruncatedOutput(e)
              ? ("truncated_output" as const)
              : ("validation_error" as const),
            path: e instanceof z.ZodError ? "/" + e.issues[0].path.join("/") : "batch",
            description: String(e).slice(0, 12000),
            ...(isTruncatedOutput(e) ? { outputTokenBudget: batchBudget.output } : {}),
          };
          await update(j => ({
            ...j,
            learningPlan: {
              ...j.learningPlan,
              batches: j.learningPlan.batches.map(b =>
                b.id === batch.id ? { ...b, lastIssue } : b,
              ),
            },
          }));
          if (isTruncatedOutput(e)) break;
          if (attempt === 1 || !canRepair) {
            if (isTruncatedOutput(e)) break;
            throw new Error(
              (!canRepair
                ? "Resumed teaching batch still invalid; checkpoint preserved: "
                : "Teaching batch failed after one repair; checkpoint preserved: ") + String(e),
            );
          }
          await update(j => ({
            ...j,
            learningPlan: {
              ...j.learningPlan,
              batches: j.learningPlan.batches.map(b =>
                b.id === batch.id ? { ...b, repairAttempted: true } : b,
              ),
            },
          }));
        }
      }
    }
    const requestedSplit = TeachingSplitSchema.safeParse(raw);
    if (requestedSplit.success) {
      if (requestedSplit.data.sceneId !== scene.id) throw new Error("Invalid split scene ID");
      await split(requestedSplit.data.utteranceGroups);
      continue;
    }
    const blocked = TeachingBlockedSchema.safeParse(raw);
    if (blocked.success) {
      if (
        blocked.data.sceneId !== scene.id ||
        !batch.utteranceIds.includes(blocked.data.utteranceIds[0])
      )
        throw new Error("Invalid blocked unit");
      throw new Error(
        "single_utterance_exceeds_budget: " +
          blocked.data.utteranceIds[0] +
          "; checkpoint preserved",
      );
    }
    if (!result && isTruncatedOutput(error)) {
      if (indivisible)
        throw new Error(
          `${batch.utteranceIds.length === 1 ? "single_utterance" : "shared_source_group"}_exceeds_budget: output truncated at ${batchBudget.output} tokens; frozen model/context capacity or input safety space prevents expansion; checkpoint preserved`,
        );
      const groups = atomicUnitGroups(
        scene.utterances.filter(u => batch.utteranceIds.includes(u.id)),
      );
      if (groups.length < 2)
        throw new Error("shared_source_group_exceeds_budget: checkpoint preserved");
      const half = Math.floor(groups.length / 2);
      await split([groups.slice(0, half).flat(), groups.slice(half).flat()]);
      continue;
    }
    if (!result) throw error ?? new Error("No validated teaching batch");
    await update(
      j => ({
        ...j,
        execution: j.execution
          ? {
              ...j.execution,
              pronunciationDiagnostics: [
                ...new Map(
                  [...(j.execution.pronunciationDiagnostics ?? []), ...completedDiagnostics].map(
                    d => [d.id, d],
                  ),
                ).values(),
              ],
            }
          : undefined,
        learningPlan: {
          ...j.learningPlan,
          batches: j.learningPlan.batches.map(b =>
            b.id === batch.id
              ? {
                  ...b,
                  result,
                  pronunciationDiagnostics: completedDiagnostics,
                  pendingPronunciation: undefined,
                  pendingTeaching: undefined,
                  lastIssue: undefined,
                }
              : b,
          ),
        },
      }),
      true,
    );
    index++;
    await update(j => ({ ...j, summary: { ...j.summary, phase: "creating" } }));
  }
}
