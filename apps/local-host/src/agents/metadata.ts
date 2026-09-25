import { spawn } from "node:child_process";
import type { AgentSettings, AgentModel, AgentModelSource } from "@immersive/core";
import { getAgentAdapter } from "../agents";
import { cliInvocation, findExecutable } from "./process";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MODEL_LIMIT = 80;

export function parseAgyModels(stdout: string): AgentModel[] {
  const cleaned = stdout.replace(/\u001b\[[0-9;]*m/g, "").trim();
  try {
    const data: unknown = JSON.parse(cleaned);
    if (Array.isArray(data) || (data && typeof data === "object" && "models" in data)) {
      return parseCatalogModels(data);
    }
  } catch { /* AGY normally prints a human-readable model table. */ }
  const found = new Map<string, AgentModel>();
  for (const row of cleaned.split(/\r?\n/)) {
    const match = row.trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]{0,119})\s{2,}(.+)$/);
    if (!match || ["model", "slug", "id"].includes(match[1].toLowerCase())) continue;
    if (!match[1].includes("-") && !match[1].includes(".")) continue;
    found.set(match[1], { id: match[1], label: match[2].trim().slice(0, 120) || match[1] });
    if (found.size >= MODEL_LIMIT) break;
  }
  return [...found.values()];
}

export function parseCatalogModels(input: unknown): AgentModel[] {
  const entries: unknown = Array.isArray(input) ? input
    : input && typeof input === "object" && "models" in input ? input.models
    : input && typeof input === "object" && "data" in input ? input.data : null;
  if (!Array.isArray(entries)) return [];
  const found = new Map<string, AgentModel>();
  for (const candidate of entries) {
    if (!candidate || typeof candidate !== "object") continue;
    const model = candidate as Record<string, unknown>;
    if (model.visibility && model.visibility !== "list") continue;
    const id = model.slug ?? model.id;
    if (typeof id !== "string" || !MODEL_ID.test(id)) continue;
    const name = model.display_name ?? model.displayName ?? model.name ?? id;
    found.set(id, { id, label: typeof name === "string" ? name.slice(0, 120) : id });
    if (found.size >= MODEL_LIMIT) break;
  }
  return [...found.values()];
}

/** Fixed executables and fixed argv only. Never pass input from the extension as a shell command. */
export function probeCli(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const { executable, argv } = cliInvocation(command, args);
    const child = spawn(executable, argv, { env, stdio: ["ignore", "pipe", "ignore"], shell: false, windowsHide: true });
    let output = "";
    let finished = false;
    let timedOut = false;
    let tooLarge = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 12_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      output += text;
      if (output.length > 12_000_000) { tooLarge = true; child.kill(); }
    });
    child.on("error", error => {
      if (!finished) { finished = true; clearTimeout(timer); reject(error); }
    });
    child.on("close", code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (timedOut) reject(new Error("Model discovery timed out."));
      else if (tooLarge) reject(new Error("Model catalog exceeded its size limit."));
      else if (code !== 0) reject(new Error("CLI model discovery is not supported or did not complete."));
      else resolve(output);
    });
  });
}

export async function discoverAgentModels(settings: AgentSettings): Promise<{
  models: AgentModel[]; source: AgentModelSource; notice?: string;
}> {
  const adapter = getAgentAdapter(settings.provider);
  const executable = await findExecutable(adapter.executableName);
  if (!executable) return { models: [], source: "unavailable", notice: adapter.label + " CLI is not installed." };
  const env = await adapter.configureEnvironment(settings);
  if (settings.provider === "agy") {
    try {
      const models = parseAgyModels(await probeCli(executable, ["models"], env));
      return models.length
        ? { models, source: "cli", notice: "Models reported by the current AGY CLI; availability depends on its active login." }
        : { models: [], source: "unavailable", notice: "AGY did not return a parseable model list. Enter a model ID manually." };
    } catch {
      return { models: [], source: "unavailable", notice: "AGY models command failed. Check the CLI login or enter a model ID manually." };
    }
  }
  if (settings.provider === "codex") {
    try {
      const models = parseCatalogModels(JSON.parse(await probeCli(executable, ["debug", "models"], env)) as unknown);
      if (models.length) return { models, source: "cli", notice: "Codex CLI catalog; model access depends on the selected login and CLI version." };
    } catch { /* Older Codex versions may not support the experimental debug command. */ }
    return { models: [], source: "unavailable", notice: "This Codex CLI cannot expose a model catalog. Choose CLI default or enter a model ID." };
  }
  if (settings.provider === "claude") {
    // Claude Code documents /model as an interactive command, not a machine-readable CLI API.
    // These CLI aliases are options, NOT an account-specific entitlement list.
    return { models: [
      { id: "sonnet", label: "Sonnet (CLI alias)" },
      { id: "opus", label: "Opus (CLI alias)" },
      { id: "haiku", label: "Haiku (CLI alias)" },
    ], source: "aliases", notice: "Claude Code /model is interactive. These aliases are not a verified list of models available to this account." };
  }
  return { models: [], source: "unavailable", notice: "No automated model catalog is available for this CLI." };
}
