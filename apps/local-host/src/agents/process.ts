import { spawn } from "node:child_process";
import { access, readFile, realpath, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { AgentSettings } from "@immersive/core";

/** Resolve an installed trusted Agent without invoking a Windows command shell. */
export async function findExecutable(name: string): Promise<string | null> {
  const home = homedir();
  const paths = [
    ...String(process.env.PATH ?? "").split(delimiter),
    "/opt/homebrew/bin", "/usr/local/bin",
    join(home, ".local/bin"), join(home, ".npm-global/bin"),
    ...(process.platform === "win32" ? [
      join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "npm"),
      join(home, "scoop", "shims"),
    ] : []),
    dirname(process.execPath),
  ].filter(Boolean);
  try {
    const versions = await readdir(join(home, ".nvm/versions/node"));
    for (const version of versions) paths.push(join(home, ".nvm/versions/node", version, "bin"));
  } catch { /* nvm is optional */ }
  for (const folder of paths) {
    if (process.platform === "win32") {
      for (const extension of [".exe", ".com"]) {
        const binary = join(folder, name + extension);
        try { await access(binary, constants.X_OK); return binary; } catch { /* next */ }
      }
      // npm publishes global .cmd shims on Windows, which require cmd.exe.
      // Resolve only their adjacent node_modules JS entry and invoke Node directly;
      // passing lesson text through cmd.exe would allow shell metacharacter injection.
      const shim = join(folder, name + ".cmd");
      try {
        const body = await readFile(shim, "utf8");
        const match = body.match(/%~?dp0%[\\/]node_modules[\\/]([A-Za-z0-9@._+\\/-]+\.m?js)\b/i);
        if (match) {
          const script = resolve(folder, "node_modules", ...match[1].split(/[\\/]/));
          const root = resolve(folder, "node_modules");
          if (script.startsWith(root + sep)) {
            await access(script, constants.R_OK);
            return script;
          }
        }
      } catch { /* missing shim or unsupported npm launcher */ }
    } else {
      const candidate = join(folder, name);
      try { await access(candidate, constants.X_OK); return candidate; } catch { /* next */ }
    }
  }
  return null;
}

export function cliInvocation(command: string, args: readonly string[]): {
  executable: string; argv: string[];
} {
  if (process.platform === "win32" && /\.m?js$/i.test(command)) {
    return { executable: process.execPath, argv: [command, ...args] };
  }
  return { executable: command, argv: [...args] };
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
    const { executable, argv } = cliInvocation(command, args);
    const child = spawn(executable, argv, {
      cwd, env, signal, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true,
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
