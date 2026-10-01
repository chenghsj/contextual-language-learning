import type { AgentSettings, JobSummary, LearningDocument } from "@immersive/core";
import type { StoragePorts } from "../storage/ports";
import { runSceneGenerationPipeline } from "./scene-pipeline";

export type SectionGenerator = (agent: AgentSettings, prompt: string, signal: AbortSignal) => Promise<unknown>;

export interface PipelineDependencies {
  storage: StoragePorts;
  generateSection?: SectionGenerator;
  generateCandidates?: SectionGenerator;
  generateSelection?: SectionGenerator;
}

/** The only generation path is source-backed contextual scene curation. */
export function runGenerationPipeline(
  jobId: string, deps: PipelineDependencies, signal: AbortSignal,
  onProgress: (summary: JobSummary) => void,
): Promise<LearningDocument> {
  return runSceneGenerationPipeline(jobId, deps, signal, onProgress);
}
