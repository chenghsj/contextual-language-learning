import type { AgentSettings } from "@immersive/core";

/** Include the provider and isolated CLI config directory in each model preference. */
export function agentModelPreferenceKey(provider: string, directory?: string): string {
  return JSON.stringify([provider, directory ?? ""]);
}

export function savedAgentModel(provider: string, directory: string | undefined,
  preferences: Readonly<Record<string, string>>, fallback = ""): string {
  return preferences[agentModelPreferenceKey(provider, directory)] ?? fallback;
}

/** Migrate older per-Agent preferences without losing the current profile's model. */
export function migrateAgentModelPreferences(
  current?: AgentSettings,
  byProvider: Readonly<Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>> = {},
): Record<string, string> {
  const models: Record<string, string> = {};
  for (const [provider, settings] of Object.entries(byProvider)) {
    if (settings && typeof settings.modelId === "string") {
      models[agentModelPreferenceKey(provider, settings.accountConfigDir)] = settings.modelId;
    }
  }
  if (current) models[agentModelPreferenceKey(current.provider, current.accountConfigDir)] = current.modelId;
  return models;
}
