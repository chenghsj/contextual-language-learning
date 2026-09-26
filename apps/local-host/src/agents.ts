import type { AgentInfo, AgentSettings } from "@immersive/core";
import { generateCustomAgent, listCustomAgents, resolveCustomExecutable } from "./agents/custom";

const IMPORTED_AGENT_ID = /^custom-[a-f0-9]{24}$/;

/** Runtime execution accepts only Host-registered, user-imported CLI definitions. */
export function assertImportedAgentProvider(provider: string): void {
  if (!IMPORTED_AGENT_ID.test(provider)) {
    throw new Error("This built-in Agent is no longer supported. Import your own CLI Agent JSON and create a new lesson.");
  }
}

export async function getAgentCatalog(): Promise<AgentInfo[]> {
  return Promise.all((await listCustomAgents()).map(async config => ({
    id: config.id, label: config.label,
    installed: (await resolveCustomExecutable(config.executable)) !== null,
    supportsAccountProfiles: !!config.profileEnvVar, custom: true,
  })));
}

export async function installedAgents(): Promise<Record<string, boolean>> {
  return Object.fromEntries((await getAgentCatalog()).map(item => [item.id, item.installed]));
}

export async function generateWithAgent(
  settings: AgentSettings, prompt: string, signal: AbortSignal,
): Promise<unknown> {
  assertImportedAgentProvider(settings.provider);
  return generateCustomAgent(settings, prompt, signal);
}
