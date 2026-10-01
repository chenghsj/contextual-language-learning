import { AgentSettingsSchema, type AgentSettings } from "@immersive/core";

/** Empty selection is a UI form state, never a valid generation Agent. */
export type AgentSelection =
  AgentSettings | { provider: ""; modelId: ""; thinkingLevel?: undefined };
export const EMPTY_AGENT_SELECTION: AgentSelection = { provider: "", modelId: "" };
export { isPiProviderId } from "@immersive/core";
export function restorePiAgentSelection(saved: unknown): AgentSelection {
  const parsed = AgentSettingsSchema.safeParse(saved);
  return parsed.success ? parsed.data : EMPTY_AGENT_SELECTION;
}
