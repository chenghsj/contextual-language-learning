import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, AgentSettings } from "@immersive/core";
import { agyAdapter } from "./agents/agy";
import { claudeAdapter } from "./agents/claude";
import { codexAdapter } from "./agents/codex";
import { findExecutable, runCLI } from "./agents/process";
import { generateCustomAgent, listCustomAgents, resolveCustomExecutable } from "./agents/custom";
import type { AgentAdapter } from "./agents/types";

/** New CLI providers register one adapter here; the document pipeline never branches on IDs. */
const agentAdapters: readonly AgentAdapter[] = [claudeAdapter, codexAdapter, agyAdapter];

export function getAgentAdapter(id: string): AgentAdapter {
  const adapter = agentAdapters.find(candidate => candidate.id === id);
  if (!adapter) throw new Error("Unsupported Agent: " + id);
  return adapter;
}

export async function getAgentCatalog(): Promise<AgentInfo[]> {
  const builtIn = await Promise.all(agentAdapters.map(async adapter => ({
    id: adapter.id, label: adapter.label,
    installed: (await findExecutable(adapter.executableName)) !== null,
    supportsAccountProfiles: adapter.supportsAccountProfiles,
  })));
  const custom = await Promise.all((await listCustomAgents()).map(async config => ({
    id: config.id, label: config.label,
    installed: (await resolveCustomExecutable(config.executable)) !== null,
    supportsAccountProfiles: !!config.profileEnvVar, custom: true,
  })));
  return [...builtIn, ...custom];
}

export async function installedAgents(): Promise<Record<string, boolean>> {
  return Object.fromEntries((await getAgentCatalog()).map(item => [item.id, item.installed]));
}

export async function generateWithAgent(
  settings: AgentSettings, prompt: string, signal: AbortSignal,
): Promise<unknown> {
  if (settings.provider.startsWith("custom-"))
    return generateCustomAgent(settings, prompt, signal);
  const adapter = getAgentAdapter(settings.provider); // built-in trusted registry
  const command = await findExecutable(adapter.executableName);
  if (!command) throw new Error(adapter.label + " CLI was not found. Install it and sign in first.");
  const env = await adapter.configureEnvironment(settings);
  const workDir = await mkdtemp(join(tmpdir(), "immersive-agent-"));
  try {
    return await adapter.generate({
      command, prompt, modelId: settings.modelId, env, workDir, signal,
      run: args => runCLI(command, args, env, workDir, signal),
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
