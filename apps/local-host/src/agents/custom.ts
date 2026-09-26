import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { CustomAgentConfigSchema, CustomAgentImportSchema, type CustomAgentConfig, type AgentSettings } from "@immersive/core";
import { appConfigRoot } from "../platform/paths";
import { parseAgentJson } from "./json";
import { findExecutable, profileEnvironment, runCLI } from "./process";

const registryFile = () => join(appConfigRoot(), "custom-agents.json");
const registrySchema = z.array(CustomAgentConfigSchema).max(20);
export function newCustomAgentId(): string {
  return "custom-" + randomBytes(12).toString("hex");
}
export async function listCustomAgents(): Promise<CustomAgentConfig[]> {
  try {
    return registrySchema.parse(JSON.parse(await readFile(registryFile(), "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new Error("Cannot load custom Agents. Check the local custom-agent registry.");
  }
}
export async function getCustomAgent(id: string): Promise<CustomAgentConfig> {
  const found = (await listCustomAgents()).find(config => config.id === id);
  if (!found) throw new Error("Custom Agent is not registered: " + id);
  return found;
}
/** Only user-authored definitions are persisted; never credentials, tokens or shell commands. */
async function writeRegistry(entries: CustomAgentConfig[]): Promise<void> {
  const root = appConfigRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const tmp = join(root, "custom-agents." + randomUUID() + ".tmp");
  try {
    await writeFile(tmp, JSON.stringify(entries, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(tmp, registryFile());
  } finally { await rm(tmp, { force: true }).catch(() => undefined); }
}
export async function saveCustomAgent(input: unknown): Promise<CustomAgentConfig[]> {
  const config = CustomAgentConfigSchema.parse(input);
  const current = await listCustomAgents();
  const existing = current.findIndex(item => item.id === config.id);
  if (existing === -1 && current.length >= 20) throw new Error("Custom Agent limit reached (20).");
  const updated = [...current];
  if (existing < 0) updated.push(config);
  else updated[existing] = config;
  await writeRegistry(updated);
  return updated;
}
/** A new import cannot supply or overwrite a Host-owned Agent ID. */
export async function importCustomAgent(input: unknown): Promise<{
  agent: CustomAgentConfig; agents: CustomAgentConfig[];
}> {
  const definition = CustomAgentImportSchema.parse(input);
  if (!(await resolveCustomExecutable(definition.executable))) {
    throw new Error(definition.label + " CLI executable not found. Install it or correct its path.");
  }
  const agent = CustomAgentConfigSchema.parse({ ...definition, id: newCustomAgentId() });
  const agents = await saveCustomAgent(agent);
  return { agent, agents };
}
export async function removeCustomAgent(id: string): Promise<CustomAgentConfig[]> {
  const current = await listCustomAgents();
  const next = current.filter(item => item.id !== id);
  if (next.length !== current.length) await writeRegistry(next);
  return next;
}
/** A path is accepted only when the user explicitly configured that executable.
 * Never invoke an interpreter or pass commands through a shell. */
export async function resolveCustomExecutable(value: string): Promise<string | null> {
  if (!value || value.length > 1024 || /[\r\n\0]/.test(value)) return null;
  if (!isAbsolute(value)) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(value)) return null;
    return findExecutable(value);
  }
  if (process.platform === "win32" && /\.(?:cmd|bat|ps1)$/i.test(value)) return null;
  try {
    const target = await realpath(value);
    if (!(await stat(target)).isFile()) return null;
    await access(target, process.platform === "win32" ? constants.R_OK : constants.X_OK);
    return target;
  } catch { return null; }
}
export function customArgs(config: CustomAgentConfig, prompt: string, modelId: string, output: string): string[] {
  const args = config.args.map(arg =>
    arg.replaceAll("{prompt}", prompt).replaceAll("{output}", output));
  if (modelId && config.modelArgument) args.push(config.modelArgument, modelId);
  else if (modelId && !config.modelArgument) throw new Error("This Agent has no model argument. Use CLI default.");
  return args;
}
function lessonValue(raw: string, label: string): unknown {
  const parsed = parseAgentJson(raw, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(label + " must return a JSON object.");
  const envelope = parsed as Record<string, unknown>;
  const response = envelope.structured_output ?? envelope.response ?? envelope.result;
  return response === undefined ? parsed : parseAgentJson(response, label);
}
export async function runCustomConfig(config: CustomAgentConfig, settings: AgentSettings,
  prompt: string, signal: AbortSignal, test = false): Promise<unknown> {
  const executable = await resolveCustomExecutable(config.executable);
  if (!executable) throw new Error(config.label + " CLI not found. Check its path and installation.");
  const env = await profileEnvironment(settings, config.profileEnvVar ?? null);
  const workDir = await mkdtemp(join(tmpdir(), "custom-agent-"));
  const outputPath = join(workDir, "last-message.json");
  try {
    const args = customArgs(config, prompt, settings.modelId, outputPath);
    const stdout = await runCLI(executable, args, env, workDir, signal, {
      ...(config.promptMode === "stdin" ? { stdin: prompt } : {}),
      timeoutMs: test ? 45_000 : 300_000,
    });
    if (config.outputMode === "stdout-json") return lessonValue(stdout, config.label);
    const size = (await stat(outputPath)).size;
    if (size > 2_000_000) throw new Error("Custom Agent output file exceeded the size limit.");
    return lessonValue(await readFile(outputPath, "utf8"), config.label);
  } finally { await rm(workDir, { recursive: true, force: true }); }
}
export async function generateCustomAgent(settings: AgentSettings, prompt: string, signal: AbortSignal): Promise<unknown> {
  return runCustomConfig(await getCustomAgent(settings.provider), settings, prompt, signal);
}
export async function testCustomConfig(config: CustomAgentConfig, modelId: string, accountConfigDir?: string): Promise<string> {
  const result = await runCustomConfig(config, { provider: config.id, modelId, accountConfigDir },
    'Return exactly one JSON object: {"customAgentTest":"ok"}. Do not include Markdown.', new AbortController().signal, true);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Custom Agent test did not return JSON.");
  return config.label + ": CLI responded with valid JSON. Lesson output will be validated during generation.";
}
