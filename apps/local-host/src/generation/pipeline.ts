import type { AgentSettings, JobSummary, LearningDocument } from "@contextual/core";
import type { StoragePorts } from "../storage/ports";
import { runLearningPointsPipeline } from "./learning-points-pipeline";

export type SectionGenerator = (
  agent: AgentSettings,
  prompt: string,
  signal: AbortSignal,
) => Promise<unknown>;

export interface PipelineDependencies {
  generationStrategy?: "compact-scenes-1" | "legacy";
  /** Limit new compact jobs to the models covered by live acceptance. Saved jobs keep their plan. */
  compactAgentFilter?: (agent: AgentSettings) => boolean;
  /** Opt-in candidate experiment; selection/teaching retain the resolved level. */
  compactAutomaticReasoning?: "low";
  /** Separate opt-in experiment for automatic selection only; teaching/review stay pinned. */
  compactAutomaticSelectionReasoning?: "low";
  resolveModel?: typeof import("../agents/pi").resolvePiModel;
  storage: StoragePorts;
  onActivity?: (
    jobId: string,
    step: string,
    activity: import("@contextual/core").GenerationActivity | null,
  ) => void;
  generateText?: typeof import("../agents/pi").generatePiText;
  generateSection?: SectionGenerator;
  generateCandidates?: SectionGenerator;
  generateSelection?: SectionGenerator;
}

/** The only generation path is source-backed contextual scene curation. */
export async function runGenerationPipeline(
  jobId: string,
  deps: PipelineDependencies,
  signal: AbortSignal,
  onProgress: (summary: JobSummary) => void,
): Promise<LearningDocument> {
  if ((await deps.storage.jobs.get(jobId))?.compactPlan) {
    const { runCompactScenePipeline } = await import("./compact-pipeline");
    return runCompactScenePipeline(jobId, deps, signal, onProgress);
  }
  return runLearningPointsPipeline(jobId, deps, signal, onProgress);
}
