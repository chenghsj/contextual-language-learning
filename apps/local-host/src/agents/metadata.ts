import { spawn } from "node:child_process";
import type { AgentSettings, AgentModel, AgentModelSource } from "@immersive/core";
import { cliInvocation } from "./process";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MODEL_LIMIT = 80;

export function parseCliModelTable(stdout: string): AgentModel[] {
  // Strip terminal control sequences and normalize whitespace seen in generic CLI table output.
  const cleaned = stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\u00a0/g, " ").trim();
  try {
    const data: unknown = JSON.parse(cleaned);
    if (Array.isArray(data) || (data && typeof data === "object" && "models" in data)) {
      return parseCatalogModels(data);
    }
  } catch { /* Some CLIs print a human-readable model table. */ }
  const found = new Map<string, AgentModel>();
  for (const row of cleaned.split(/[\r\n]+/)) {
    // CLI table columns may be separated by ordinary spaces, tabs, or nonbreaking spaces.
    const match = row.trim().match(/^([A-Za-z0-9][A-Za-z0-9._-]{0,119})\s+(.+)$/);
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
export function probeCli(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const { executable, argv } = cliInvocation(command, args);
    const child = spawn(executable, argv, { env, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
    let output = "";
    let errorOutput = "";
    let finished = false;
    let timedOut = false;
    let tooLarge = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 12_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      output += text;
      if (output.length > 12_000_000) { tooLarge = true; child.kill(); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      errorOutput += text;
      if (errorOutput.length > 12_000_000) { tooLarge = true; child.kill(); }
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
      else resolve({ stdout: output, stderr: errorOutput });
    });
  });
}

export { piModels as discoverAgentModels } from "./pi";
