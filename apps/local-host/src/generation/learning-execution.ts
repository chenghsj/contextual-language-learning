import { type JobSnapshotV5, type JobSummary, pronunciationMissingCount } from "@contextual/core";
import { generatePiText } from "../agents/pi";
import { parseAgentJson } from "../agents/json";
import type { PipelineDependencies } from "./pipeline";
import { initialLearningPointsBudget, learningPointsPrompts } from "./learning-points-prompts";

function requireV5(job: unknown): JobSnapshotV5 {
  if (!job || (job as JobSnapshotV5).schemaVersion !== 5)
    throw new Error("V7 generation requires a V5 checkpoint");
  return job as JobSnapshotV5;
}
function assertRunning(signal: AbortSignal, job: JobSnapshotV5) {
  if (signal.aborted || job.summary.status !== "running") throw new Error("Job was interrupted");
}
export class ModelRequestError extends Error {}
export const isTruncatedOutput = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).startsWith("truncated_output:");
function progress(job: JobSnapshotV5): JobSnapshotV5 {
  const p = job.learningPlan;
  return {
    ...job,
    summary: {
      ...job.summary,
      pronunciationMissingCount: pronunciationMissingCount(
        p.batches.flatMap(b => b.pronunciationDiagnostics ?? []),
      ),
      completed:
        p.candidateWindows.filter(w => w.candidates !== undefined).length +
        (p.selected ? 1 : 0) +
        p.batches.filter(b => b.result).length,
      total:
        p.candidateWindows.length +
        1 +
        (p.selected ? p.batches.length : job.request.profile.sceneCount),
      updatedAt: new Date().toISOString(),
    },
  };
}
/** One execution owns model calls, paid usage and the serialized checkpoint writer. */
export async function createLearningExecution(
  jobId: string,
  deps: PipelineDependencies,
  signal: AbortSignal,
  onProgress: (summary: JobSummary) => void,
) {
  let job = requireV5(await deps.storage.jobs.get(jobId));
  assertRunning(signal, job);
  const capacity = job.execution ?? { contextWindow: 128000, maxOutputTokens: 8192 };
  const budget = initialLearningPointsBudget(capacity, job.request.agent.thinkingLevel);
  const prompts = learningPointsPrompts(job.execution?.promptVersion);
  const { system, pointsPromptFits } = prompts;
  const candidatesController = new AbortController();
  const abortCandidates = () => candidatesController.abort(signal.reason);
  signal.addEventListener("abort", abortCandidates, { once: true });
  if (signal.aborted) abortCandidates();
  let concurrency = 2;
  let writes = Promise.resolve();
  const update = (change: (j: JobSnapshotV5) => JobSnapshotV5, audit = false) => {
    const work = writes.then(async () => {
      job = requireV5(
        await deps.storage.jobs.update(jobId, current => {
          const j = requireV5(current);
          if (!audit) assertRunning(signal, j);
          return progress(change(j));
        }),
      );
      onProgress(job.summary);
    });
    writes = work.catch(() => undefined);
    return work;
  };
  const generate = async (
    prompt: string,
    step: string,
    kind: "candidate" | "selection" | "teaching",
    callBudget = budget,
  ) => {
    assertRunning(signal, job);
    const callSignal = kind === "candidate" ? candidatesController.signal : signal;
    callSignal.throwIfAborted();
    if (!pointsPromptFits(prompt, callBudget)) throw new Error("Input exceeds frozen model budget");
    const injected =
      kind === "candidate"
        ? (deps.generateCandidates ?? deps.generateSection)
        : kind === "selection"
          ? (deps.generateSelection ?? deps.generateSection)
          : deps.generateSection;
    if (injected) return injected(job.request.agent, prompt, callSignal);
    if (!job.execution) throw new Error("V7 model identity must be pinned before generation");
    const execution = job.execution;
    const response = await (deps.generateText ?? generatePiText)(
      { ...job.request.agent, provider: execution.provider, modelId: execution.modelId },
      prompt,
      callSignal,
      {
        format: "json",
        step: callBudget.output === budget.output ? step : `${step}-output-${callBudget.output}`,
        maxOutputTokens: callBudget.output,
        allowIncomplete: true,
        retainCompletedOutputOnCancel: true,
        systemPrompt: system,
        onActivity: activity => deps.onActivity?.(jobId, step, activity),
        onCall: async call => {
          // Persist paid usage before parsing. Truncated JSON must remain visible in the call history.
          if (call.provider !== execution.provider || call.modelId !== execution.modelId)
            throw new Error("Actual model differs from frozen V7 model");
          await update(
            j => ({
              ...j,
              execution: { ...j.execution!, calls: [...j.execution!.calls, call] },
              summary: { ...j.summary, retry: undefined },
            }),
            true,
          );
        },
        onRetry: async retry => {
          if (/\b429\b/.test(retry.reason)) concurrency = 1;
          await update(j => ({ ...j, summary: { ...j.summary, retry } }));
        },
      },
    ).catch(error => {
      throw new ModelRequestError(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    });
    if (response.incomplete) throw new Error("truncated_output: model reached output limit");
    if (!response.text.trim())
      throw new ModelRequestError(
        "Model returned no final answer; available usage retained. Unknown paid failures are not automatically replayed.",
      );
    try {
      return parseAgentJson(response.text, "Pi");
    } catch (error) {
      // Some providers report stop instead of length after spending nearly the
      // entire allowance on reasoning. Valid JSON near the cap is still accepted.
      if ((response.call.usage?.output ?? 0) >= callBudget.output * 0.98)
        throw new Error("truncated_output: invalid JSON near model output limit", { cause: error });
      throw error;
    }
  };
  return {
    get job() {
      return job;
    },
    get candidateConcurrency() {
      return concurrency;
    },
    capacity,
    budget,
    prompts,
    signal,
    candidatesController,
    generate,
    update,
    finishCandidates: () => signal.removeEventListener("abort", abortCandidates),
    close: () => {
      signal.removeEventListener("abort", abortCandidates);
      candidatesController.abort();
    },
  };
}
export type LearningExecution = Awaited<ReturnType<typeof createLearningExecution>>;
