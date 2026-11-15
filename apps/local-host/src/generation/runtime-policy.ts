import type { PipelineDependencies } from "./pipeline";

/** Live-accepted recipe. The user accepts medium teaching/review latency. */
export const acceptedGenerationPolicy = {
  generationStrategy: "compact-scenes-1",
  compactAutomaticReasoning: "low",
  compactAutomaticSelectionReasoning: "low",
  compactAgentFilter: agent =>
    agent.provider === "antigravity" &&
    agent.modelId === "gemini-3.8-flash" &&
    agent.thinkingLevel === undefined,
} satisfies Pick<
  PipelineDependencies,
  | "generationStrategy"
  | "compactAutomaticReasoning"
  | "compactAutomaticSelectionReasoning"
  | "compactAgentFilter"
>;
