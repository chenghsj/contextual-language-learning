// Compatibility entry point: orchestration lives in generation/pipeline.ts.
export { runGenerationPipeline } from "./generation/pipeline";
export type { PipelineDependencies, SectionGenerator } from "./generation/pipeline";
export { toMarkdown } from "./generation/markdown";
