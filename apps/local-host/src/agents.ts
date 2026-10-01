import type { AgentSettings } from "@immersive/core";
import { generatePi, piProviders } from "./agents/pi";
export { assertPiProvider } from "./agents/pi";
export async function getAgentCatalog() {
  return (await piProviders()).map(provider => ({
    id: provider.id,
    label: provider.label,
    installed: provider.connected,
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
