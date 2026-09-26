import type { AgentSettings } from "@immersive/core";

/** BYO setup has no built-in providers; historical snapshots retain their original IDs. */
export const EMPTY_AGENT_SELECTION: AgentSettings = { provider: "", modelId: "" };

export function isImportedAgentId(provider: unknown): provider is string {
  return typeof provider === "string" && /^custom-[a-f0-9]{24}$/.test(provider);
}

/** Restore only a user-imported Agent; never silently reactivate an old built-in default. */
export function restoreImportedAgentSelection(saved: unknown): AgentSettings {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return EMPTY_AGENT_SELECTION;
  const entry = saved as Partial<AgentSettings>;
  if (!isImportedAgentId(entry.provider) || typeof entry.modelId !== "string") {
    return EMPTY_AGENT_SELECTION;
  }
  return {
    provider: entry.provider,
    modelId: entry.modelId,
    ...(typeof entry.accountConfigDir === "string" && entry.accountConfigDir.trim()
      ? { accountConfigDir: entry.accountConfigDir } : {}),
  };
}
