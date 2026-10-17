import { isPiProviderId } from "@contextual/core";
export function agentModelPreferenceKey(provider: string): string {
  return provider;
}
export function savedAgentModel(
  provider: string,
  preferences: Readonly<Record<string, string>>,
  fallback = "",
): string {
  return isPiProviderId(provider) ? (preferences[provider] ?? fallback) : "";
}
