import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync, constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { AgentSettings } from "@immersive/core";

const names = ["claude", "codex", "agy"] as const;
type AgentName = typeof names[number];

async function executable(name: AgentName): Promise<string | null> {
  const home = homedir();
  const paths = [
    ...String(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".local/bin"),
    join(home, ".npm-global/bin"),
    dirname(process.execPath),
  ].filter(Boolean);
  try {
    const versions = await readdir(join(home, ".nvm/versions/node"));
    for (const version of versions) paths.push(join(home, ".nvm/versions/node", version, "bin"));
  } catch { /* nvm is optional */ }
  for (const folder of paths) {
    const candidate = join(folder, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* continue searching */ }
  }
  return null;
}

export async function installedAgents(): Promise<Record<AgentName, boolean>> {
  const [claude, codex, agy] = await Promise.all(names.map(name => executable(name)));
  return { claude: !!claude, codex: !!codex, agy: !!agy };
}

function accountEnvironment(settings: AgentSettings): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!settings.accountConfigDir) return env;
  if (settings.provider === "agy") throw new Error("AGY account isolation is not supported; use its current CLI login");
  const path = resolve(settings.accountConfigDir);
  const home = resolve(homedir());
  if (!isAbsolute(settings.accountConfigDir) || !path.startsWith(home + sep) || !existsSync(path)) {
    throw new Error("Account profile must be an existing directory inside your home folder");
  }
  if (settings.provider === "claude") env.CLAUDE_CONFIG_DIR = path;
  if (settings.provider === "codex") env.CODEX_HOME = path;
  return env;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const child = spawn(command, args, {
      cwd, env, signal, stdio: ["ignore", "pipe", "pipe"], shell: false,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
      if (stdout.length > 2_000_000) child.kill();
    });
    child.stderr.on("data", (data: string) => {
      stderr = (stderr + data).slice(-16_000);
    });
    child.on("error", error => {
      if (!done) { done = true; reject(error); }
    });
    child.on("close", code => {
      if (done) return;
      done = true;
      if (code !== 0) reject(new Error((stderr || "CLI exited with status " + code).slice(-1200)));
      else if (stdout.length > 2_000_000) reject(new Error("CLI output exceeded the size limit"));
      else resolveOutput(stdout);
    });
  });
}

function extractPayload(output: string, provider: AgentName): unknown {
  const raw = JSON.parse(output.trim()) as Record<string, unknown>;
  if (provider === "claude") return raw.structured_output ?? raw.result ?? raw;
  if (provider === "agy") {
    if (raw.status !== "SUCCESS") throw new Error(String(raw.error ?? "AGY did not complete successfully"));
    return raw.structured_output ?? raw.response;
  }
  return raw;
}

export async function generateWithAgent(settings: AgentSettings, prompt: string, signal: AbortSignal): Promise<unknown> {
  const command = await executable(settings.provider);
  if (!command) throw new Error(settings.provider + " CLI was not found. Install it and sign in first.");
  const env = accountEnvironment(settings);
  const workDir = await mkdtemp(join(tmpdir(), "immersive-agent-"));
  try {
    const model = settings.modelId.trim() ? ["--model", settings.modelId.trim()] : [];
    if (settings.provider === "claude") {
      const output = await run(command, ["-p", prompt, "--output-format", "json", "--max-turns", "1", "--tools", "", ...model], env, workDir, signal);
      const payload = extractPayload(output, "claude");
      return typeof payload === "string" ? JSON.parse(payload) : payload;
    }
    if (settings.provider === "agy") {
      const output = await run(command, ["-p", prompt, "--output-format", "json", "--sandbox", ...model], env, workDir, signal);
      const payload = extractPayload(output, "agy");
      return typeof payload === "string" ? JSON.parse(payload) : payload;
    }
    const lastMessage = join(workDir, "last-message.json");
    await run(command, ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message", lastMessage, ...model, prompt], env, workDir, signal);
    const output = await readFile(lastMessage, "utf8");
    return JSON.parse(output.trim());
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
