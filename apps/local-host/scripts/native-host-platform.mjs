import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, chmod, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

const exec = promisify(execFile);
export const HOST_NAME = "dev.immersive.language_learning";
const browsers = new Set(["chrome", "edge", "chromium"]);

export function browserManifestLocation(
  platform, browser, home = homedir(), env = process.env,
) {
  if (!browsers.has(browser)) throw new Error("Browser must be chrome, edge or chromium.");
  if (platform === "darwin") {
    const folder = {
      chrome: "Google/Chrome", edge: "Microsoft Edge", chromium: "Chromium",
    }[browser];
    return { type: "file", path: join(home, "Library/Application Support", folder,
      "NativeMessagingHosts", HOST_NAME + ".json") };
  }
  if (platform === "linux") {
    const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME : join(home, ".config");
    const folder = { chrome: "google-chrome", edge: "microsoft-edge", chromium: "chromium" }[browser];
    return { type: "file", path: join(config, folder, "NativeMessagingHosts", HOST_NAME + ".json") };
  }
  if (platform === "win32") {
    const vendor = {
      chrome: "Google\\Chrome", edge: "Microsoft\\Edge", chromium: "Chromium",
    }[browser];
    return { type: "registry", key: "HKCU\\Software\\" + vendor + "\\NativeMessagingHosts\\" + HOST_NAME };
  }
  throw new Error("Unsupported Native Host platform: " + platform);
}

/** Installer Strategy: macOS/Linux use executable shell scripts, Windows needs an actual .exe. */
export function installationDir(platform, home = homedir(), env = process.env) {
  if (platform === "darwin") return join(home, "Library/Application Support/Immersive Learning/native-host");
  if (platform === "linux") {
    const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME : join(home, ".local/share");
    return join(data, "immersive-language-learning/native-host");
  }
  if (platform === "win32") return join(
    env.LOCALAPPDATA || join(home, "AppData", "Local"), "Immersive Learning", "native-host");
  throw new Error("Unsupported Native Host platform: " + platform);
}

async function atomicCopy(source, target, mode = 0o600) {
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await copyFile(source, temporary);
    await chmod(temporary, mode);
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

async function atomicWrite(target, content, mode = 0o600) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { mode, flag: "wx" });
    await chmod(temporary, mode);
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
}

const shQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function installLauncher(platform, installDir, sourceRoot, entry, nodePath) {
  if (platform !== "win32") {
    const searchPath = [
      dirname(nodePath), "/opt/homebrew/bin", "/usr/local/bin",
      join(homedir(), ".local/bin"), join(homedir(), ".npm-global/bin"),
    ].join(":");
    const launcher = join(installDir, "launch.sh");
    await atomicWrite(launcher,
      "#!/bin/sh\nexport PATH=" + shQuote(searchPath) + ":\"$PATH\"\n" +
      "exec " + shQuote(nodePath) + " " + shQuote(entry) + "\n", 0o700);
    return launcher;
  }
  // Chrome's Windows manifest requires a native executable, not a .cmd/.bat shim.
  // Compile a tiny binary stdio proxy locally with the Windows PowerShell/.NET
  // included in Windows. No code is downloaded or executed from the network.
  const source = join(sourceRoot, "scripts/windows-launcher.cs");
  const compiler = join(sourceRoot, "scripts/compile-launcher.ps1");
  await access(source);
  await access(compiler);
  await atomicCopy(source, join(installDir, "windows-launcher.cs"));
  await atomicWrite(join(installDir, "node-path.txt"), nodePath + "\n");
  const launcher = join(installDir, "native-host.exe");
  const temporary = join(installDir, "native-host." + randomUUID() + ".exe");
  try {
    await exec("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", compiler, "-Source", join(installDir, "windows-launcher.cs"),
      "-Output", temporary,
    ], { timeout: 120_000, maxBuffer: 16_384, windowsHide: true });
    await rename(temporary, launcher);
  } catch (error) {
    throw new Error("Could not compile the Windows Native Host launcher. Windows PowerShell 5.1 " +
      "and .NET Framework are required. Close Chrome before updating an existing Host. " +
      String(error).slice(0, 500));
  } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  return launcher;
}

export async function installNativeHost({
  platform = process.platform, browser = "chrome", extensionId,
  sourceRoot, sourceEntry, nodePath = process.execPath,
}) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Invalid 32-character Chromium extension ID.");
  const location = browserManifestLocation(platform, browser);
  await access(sourceEntry);
  const root = installationDir(platform);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const entry = join(root, "native-host.mjs");
  await atomicCopy(sourceEntry, entry);
  const launcher = await installLauncher(platform, root, sourceRoot, entry, nodePath);
  const manifest = {
    name: HOST_NAME,
    description: "Local agent host for Immersive Language Learning",
    path: launcher,
    type: "stdio",
    allowed_origins: ["chrome-extension://" + extensionId + "/"],
  };
  const manifestPath = location.type === "file"
    ? location.path : join(root, HOST_NAME + ".json");
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (location.type === "registry") {
    // HKCU is per-user; no admin privileges and no global browser setting changes.
    await exec("reg.exe", ["add", location.key, "/ve", "/t", "REG_SZ",
      "/d", manifestPath, "/f"], { timeout: 20_000, maxBuffer: 8192, windowsHide: true });
  }
  return { launcher, manifestPath, location };
}
