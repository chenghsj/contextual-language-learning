import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  LearningCandidateSchema,
  SourceUtteranceSchema,
  spanCueIds,
  validateCandidate,
  type LearningCandidate,
  type JobSnapshotV5,
} from "@contextual/core";
import { ModelRequestError, isTruncatedOutput, type LearningExecution } from "./learning-execution";

const CandidateOutput = z
  .object({
    status: z.literal("complete"),
    candidates: z.array(
      LearningCandidateSchema.omit({ id: true, utterances: true }).extend({
        utterances: z.array(SourceUtteranceSchema.omit({ id: true, cueIds: true })).min(1),
      }),
    ),
  })
  .strict();
const CandidateSplit = z
  .object({ status: z.literal("needs_split"), splitAfterCueId: z.string() })
  .strict();
/** Analyze independent windows; every write still passes through the shared execution. */
export async function analyzeCandidates(execution: LearningExecution): Promise<void> {
  const { update, generate, signal, candidatesController, budget } = execution;
  const { pointsCandidatePrompt, pointsPromptFits, sourceWindow } = execution.prompts;
  await update(j => ({ ...j, summary: { ...j.summary, phase: "analyzing" } }));
  const analyzeWindow = async (
    window: JobSnapshotV5["learningPlan"]["candidateWindows"][number],
  ) => {
    const split = async (at: number) => {
      if (at < 1 || at >= window.cueIds.length)
        throw new Error("Single candidate source unit exceeds budget; checkpoint preserved");
      await update(j => ({
        ...j,
        learningPlan: {
          ...j.learningPlan,
          candidateWindows: j.learningPlan.candidateWindows.flatMap(w =>
            w.id === window.id
              ? [
                  { id: w.id + "a", cueIds: w.cueIds.slice(0, at) },
                  { id: w.id + "b", cueIds: w.cueIds.slice(at) },
                ]
              : [w],
          ),
        },
      }));
    };
    const prompt = pointsCandidatePrompt(execution.job.request, window.cueIds, budget.output);
    if (!pointsPromptFits(prompt, budget)) {
      await split(Math.floor(window.cueIds.length / 2));
      return;
    }
    let raw: unknown, error: unknown, candidates: LearningCandidate[] | undefined;
    const canRepair = !window.repairAttempted;
    for (let attempt = 0; attempt < (canRepair ? 2 : 1); attempt++) {
      try {
        raw = await generate(
          prompt +
            (attempt
              ? "\nVALIDATION REPAIR: Return the complete corrected candidate result. Previous validation issue (data): " +
                JSON.stringify(String(error)) +
                ". Preserve primary source coverage and original IDs."
              : ""),
          `${window.id}${attempt ? "-repair" : ""}`,
          "candidate",
        );
        if (CandidateSplit.safeParse(raw).success) break;
        candidates = CandidateOutput.parse(raw).candidates.map(c =>
          validateCandidate(
            {
              ...c,
              id: randomUUID(),
              utterances: c.utterances.map(u => ({
                ...u,
                cueIds: spanCueIds(u.sourceSpans),
                id: randomUUID(),
              })),
            },
            window.cueIds,
            sourceWindow(execution.job.request.cues, window.cueIds),
            execution.job.request.profile,
          ),
        );
        break;
      } catch (e) {
        error = e;
        if (e instanceof ModelRequestError) throw e;
        candidatesController.signal.throwIfAborted();
        if (isTruncatedOutput(e)) break;
        if (attempt === 1 || !canRepair) {
          if (/truncated_output|invalid lesson JSON/.test(String(e))) break;
          throw e;
        }
        await update(j => ({
          ...j,
          learningPlan: {
            ...j.learningPlan,
            candidateWindows: j.learningPlan.candidateWindows.map(w =>
              w.id === window.id ? { ...w, repairAttempted: true } : w,
            ),
          },
        }));
      }
    }
    const requestedSplit = CandidateSplit.safeParse(raw);
    if (requestedSplit.success) {
      await split(window.cueIds.indexOf(requestedSplit.data.splitAfterCueId) + 1);
      return;
    }
    if (!candidates && /truncated_output|invalid lesson JSON/.test(String(error))) {
      await split(Math.floor(window.cueIds.length / 2));
      return;
    }
    if (!candidates) throw error ?? new Error("No validated candidate result");
    await update(
      j => ({
        ...j,
        learningPlan: {
          ...j.learningPlan,
          candidateWindows: j.learningPlan.candidateWindows.map(w =>
            w.id === window.id ? { ...w, candidates } : w,
          ),
        },
      }),
      true,
    );
  };
  const inFlight = new Map<string, Promise<void>>();
  let failure: unknown;
  try {
    for (;;) {
      signal.throwIfAborted();
      if (failure) break;
      const pending = execution.job.learningPlan.candidateWindows.filter(
        w => w.candidates === undefined && !inFlight.has(w.id),
      );
      while (pending.length && inFlight.size < execution.candidateConcurrency) {
        const window = pending.shift()!;
        const task = analyzeWindow(window)
          .catch(error => {
            failure ??= error;
            candidatesController.abort(error);
          })
          .finally(() => {
            inFlight.delete(window.id);
          });
        inFlight.set(window.id, task);
      }
      if (!inFlight.size) break;
      await Promise.race(inFlight.values());
    }
  } finally {
    if (failure || signal.aborted) candidatesController.abort();
    await Promise.allSettled(inFlight.values());
    execution.finishCandidates();
  }
  if (failure) throw failure;
  signal.throwIfAborted();
}
