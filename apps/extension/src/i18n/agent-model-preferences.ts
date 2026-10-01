import type { AgentSettings } from "@immersive/core";
import { isPiProviderId } from "../agent-selection";

/** Include imported Agent ID and optional isolated CLI config directory in model preference. */
export function agentModelPreferenceKey(provider: string, directory?: string): string {
  return JSON.stringify([provider, directory ?? ""]);
}

/** An obsolete provider is never restored as a usable Agent preference. */
export function savedAgentModel(provider: string, directory: string | undefined,
  preferences: Readonly<Record<string, string>>, fallback = ""): string {
  if (!isPiProviderId(provider)) return "";
  return preferences[agentModelPreferenceKey(provider, directory)] ?? fallback;
}

/** Keep only imported-Agent preferences; obsolete built-in settings are not used or re-saved. */
export function filterImportedModelPreferences(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const entries = Object.entries(input).filter(([key, value]) => {
    if (key.length > 2048 || typeof value !== "string" || value.length > 120) return false;
    try {
      const parsed: unknown = JSON.parse(key);
      return Array.isArray(parsed) && parsed.length === 2 &&
        isPiProviderId(parsed[0]) && typeof parsed[1] === "string" &&
        parsed[1].length <= 1024;
    } catch { return false; }
  });
  return Object.fromEntries(entries) as Record<string, string>;
}

/** Migrate legacy preference *format* for imported Agents, not removed provider IDs. */
export function migrateAgentModelPreferences(
  current?: AgentSettings,
  byProvider: Readonly<Record<string, Pick<AgentSettings, "modelId" | "accountConfigDir">>> = {},
): Record<string, string> {
  const models: Record<string, string> = {};
  for (const [provider, settings] of Object.entries(byProvider)) {
    if (isPiProviderId(provider) && settings && typeof settings.modelId === "string") {
      models[agentModelPreferenceKey(provider, settings.accountConfigDir)] = settings.modelId;
    }
  }
  if (current && isPiProviderId(current.provider)) {
    models[agentModelPreferenceKey(current.provider, current.accountConfigDir)] = current.modelId;
  }
  return models;
}
