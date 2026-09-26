import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, AgentSettings } from "@immersive/core";
import { agyAdapter } from "./agents/agy";
import { claudeAdapter } from "./agents/claude";
import { codexAdapter } from "./agents/codex";
import { findExecutable, runCLI } from "./agents/process";
import { customAgentAdapter } from "./agents/custom";
import { findCustomAgent, listCustomAgents } from "./agents/custom-registry";
import type { AgentAdapter } from "./agents/types";

/** New CLI providers register one adapter here; the document pipeline never branches on IDs. */
const agentAdapters: readonly AgentAdapter[] = [claudeAdapter, codexAdapter, agyAdapter];

export function getAgentAdapter(id: string): AgentAdapter {
  const adapter = agentAdapters.find(candidate => candidate.id === id);
  if (!adapter) throw new Error("Unsupported built-in Agent: " + id);
  return adapter;
}

export async function resolveAgentAdapter(id: string): Promise<AgentAdapter> {
  const builtIn = agentAdapters.find(candidate => candidate.id === id);
  if (builtIn) return builtIn;
  const definition = await findCustomAgent(id);
  if (!definition) throw new Error("Unsupported Agent: " + id);
  return customAgentAdapter(definition);
}

export async function resolveAgentExecutable(adapter: AgentAdapter): Promise<string | null> {
  return adapter.resolveExecutable ? adapter.resolveExecutable() : findExecutable(adapter.executableName);
}

export async function getAgentCatalog(): Promise<AgentInfo[]> {
  const custom = (await listCustomAgents()).map(customAgentAdapter);
  return Promise.all([...agentAdapters, ...custom].map(async adapter => ({
    id: adapter.id,
    label: adapter.label,
    installed: (await resolveAgentExecutable(adapter)) !== null,
    supportsAccountProfiles: adapter.supportsAccountProfiles,
    ...(adapter.custom ? { custom: true } : {}),
  })));
}

export async function installedAgents(): Promise<Record<string, boolean>> {
  return Object.fromEntries((await getAgentCatalog()).map(item => [item.id, item.installed]));
}

export async function generateWithAgent(
  settings: AgentSettings, prompt: string, signal: AbortSignal,
): Promise<unknown> {
  const adapter = await resolveAgentAdapter(settings.provider);
  // Custom commands are user-authorized definitions stored by the Native Host.
  // They are still executed without a shell and with a bounded argv schema.
  const command = await resolveAgentExecutable(adapter);
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
