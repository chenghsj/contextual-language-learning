import type { AgentSettings, JobSummary, LearningDocument } from "@contextual/core";
import type { StoragePorts } from "../storage/ports";
import { runLearningPointsPipeline } from "./learning-points-pipeline";

export type SectionGenerator = (
  agent: AgentSettings,
  prompt: string,
  signal: AbortSignal,
) => Promise<unknown>;

export interface PipelineDependencies {
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
  return runLearningPointsPipeline(jobId, deps, signal, onProgress);
}
