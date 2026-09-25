import { spawn } from "node:child_process";
import { access, realpath, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { AgentSettings } from "@immersive/core";

export async function findExecutable(name: string): Promise<string | null> {
  const home = homedir();
  const paths = [
    ...String(process.env.PATH ?? "").split(":"),
    "/opt/homebrew/bin", "/usr/local/bin",
    join(home, ".local/bin"), join(home, ".npm-global/bin"),
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
    } catch { /* try another configured installation */ }
  }
  return null;
}

export async function profileEnvironment(
  settings: AgentSettings, environmentVariable: "CLAUDE_CONFIG_DIR" | "CODEX_HOME" | null,
): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  if (!settings.accountConfigDir) return env;
  if (environmentVariable === null) {
    throw new Error(settings.provider + " does not support isolated account configuration");
  }
  if (!isAbsolute(settings.accountConfigDir)) {
    throw new Error("Account profile must be an absolute path inside your home directory");
  }
  const profile = await realpath(resolve(settings.accountConfigDir));
  const home = await realpath(homedir());
  if (!profile.startsWith(home + sep) || !(await stat(profile)).isDirectory()) {
    throw new Error("Account profile must be an existing directory inside your home folder");
  }
  env[environmentVariable] = profile;
  return env;
}

export function runCLI(
  command: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string, signal: AbortSignal,
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    let exceeded = false;
    const child = spawn(command, [...args], {
      cwd, env, signal, stdio: ["ignore", "pipe", "pipe"], shell: false,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
      if (stdout.length > 2_000_000) {
        exceeded = true;
        child.kill();
      }
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
      if (exceeded) reject(new Error("CLI output exceeded the size limit"));
      else if (code !== 0) reject(new Error((stderr || "CLI exited with status " + code).slice(-1200)));
      else resolveOutput(stdout);
    });
  });
}
