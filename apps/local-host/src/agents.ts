import type { AgentSettings } from "@contextual/core";
import { generatePi, piProviders } from "./agents/pi";
import { PI_PROVIDER_IDS } from "@contextual/core";
import { SecureCredentialError } from "./platform/credential-vault";
export { assertPiProvider } from "./agents/pi";
export async function getAgentCatalog() {
  let providers;
  try {
    providers = await piProviders();
  } catch (error) {
    // Credential-store failures must not make the entire Native Host appear offline.
    // The explicit piProviders/login requests still return the actionable storage error.
    if (!(error instanceof SecureCredentialError)) throw error;
    return PI_PROVIDER_IDS.map(id => ({ id, label: id, installed: false }));
  }
  return providers.map(provider => ({
    id: provider.id,
    label: provider.label,
    installed: provider.connected,
    ...(provider.credentialMethod ? { credentialMethod: provider.credentialMethod } : {}),
  }));
}
export async function installedAgents(): Promise<Record<string, boolean>> {
  return Object.fromEntries((await getAgentCatalog()).map(item => [item.id, item.installed]));
}
export async function generateWithAgent(
  settings: AgentSettings,
  prompt: string,
  signal: AbortSignal,
): Promise<unknown> {
  return generatePi(settings, prompt, signal);
}
