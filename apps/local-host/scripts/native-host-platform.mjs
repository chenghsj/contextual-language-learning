import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, chmod, copyFile, lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

const exec = promisify(execFile);
export const HOST_NAME = "dev.contextual.language_learning";
const browsers = new Set(["chrome", "edge", "chromium"]);

export function browserManifestLocation(platform, browser, home = homedir(), env = process.env) {
  if (!browsers.has(browser)) throw new Error("Browser must be chrome, edge or chromium.");
  if (platform === "darwin") {
    const folder = {
      chrome: "Google/Chrome",
      edge: "Microsoft Edge",
      chromium: "Chromium",
    }[browser];
    return {
      type: "file",
      path: join(
        home,
        "Library/Application Support",
        folder,
        "NativeMessagingHosts",
        HOST_NAME + ".json",
      ),
    };
  }
  if (platform === "linux") {
    const config =
      env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
        ? env.XDG_CONFIG_HOME
        : join(home, ".config");
    const folder = { chrome: "google-chrome", edge: "microsoft-edge", chromium: "chromium" }[
      browser
    ];
    return {
      type: "file",
      path: join(config, folder, "NativeMessagingHosts", HOST_NAME + ".json"),
    };
  }
  if (platform === "win32") {
    const vendor = {
      chrome: "Google\\Chrome",
      edge: "Microsoft\\Edge",
      chromium: "Chromium",
    }[browser];
    return {
      type: "registry",
      key: "HKCU\\Software\\" + vendor + "\\NativeMessagingHosts\\" + HOST_NAME,
    };
  }
  throw new Error("Unsupported Native Host platform: " + platform);
}

/** Installer Strategy: macOS/Linux use executable shell scripts, Windows needs an actual .exe. */
export function installationDir(platform, home = homedir(), env = process.env) {
  if (platform === "darwin")
    return join(home, "Library/Application Support/Contextual Language Learning/native-host");
  if (platform === "linux") {
    const data =
      env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
        ? env.XDG_DATA_HOME
        : join(home, ".local/share");
    return join(data, "contextual-language-learning/native-host");
  }
  if (platform === "win32")
    return join(
      env.LOCALAPPDATA || join(home, "AppData", "Local"),
      "Contextual Language Learning",
      "native-host",
    );
  throw new Error("Unsupported Native Host platform: " + platform);
}

async function atomicCopy(source, target, mode = 0o600) {
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await copyFile(source, temporary);
    await chmod(temporary, mode);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function atomicWrite(target, content, mode = 0o600) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const temporary = target + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, content, { mode, flag: "wx" });
    await chmod(temporary, mode);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

const shQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

async function copyImmutable(source, target, mode = 0o700) {
  try {
    await access(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await atomicCopy(source, target, mode);
  }
}

async function installLauncher(
  platform,
  installDir,
  sourceRoot,
  entry,
  nodePath,
  home,
  run,
  prebuiltLauncher,
  immutable = false,
) {
  if (platform !== "win32") {
    const searchPath = [
      dirname(nodePath),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      join(home, ".local/bin"),
      join(home, ".npm-global/bin"),
    ].join(":");
    const launcher = join(installDir, "launch.sh");
    await atomicWrite(
      launcher,
      "#!/bin/sh\nexport PATH=" +
        shQuote(searchPath) +
        ':"$PATH"\n' +
        "exec " +
        shQuote(nodePath) +
        " " +
        shQuote(entry) +
        "\n",
      0o700,
    );
    return launcher;
  }
  if (prebuiltLauncher) {
    await atomicWrite(join(installDir, "node-path.txt"), nodePath + "\n");
    const launcher = join(installDir, "native-host.exe");
    await (immutable ? copyImmutable : atomicCopy)(prebuiltLauncher, launcher, 0o700);
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
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        compiler,
        "-Source",
        join(installDir, "windows-launcher.cs"),
        "-Output",
        temporary,
      ],
      { timeout: 120_000, maxBuffer: 16_384, windowsHide: true },
    );
    await rename(temporary, launcher);
  } catch (error) {
    throw new Error(
      "Could not compile the Windows Native Host launcher. Windows PowerShell 5.1 " +
        "and .NET Framework are required. Close Chrome before updating an existing Host. " +
        String(error).slice(0, 500),
    );
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return launcher;
}

export async function installNativeHost({
  platform = process.platform,
  browser = "chrome",
  extensionId,
  sourceRoot,
  sourceEntry,
  nodePath = process.execPath,
  bundledRuntime,
  prebuiltLauncher,
  bundleKey,
  home = homedir(),
  env = process.env,
  run = exec,
}) {
  if (!/^[a-p]{32}$/.test(extensionId))
    throw new Error("Invalid 32-character Chromium extension ID.");
  if (bundleKey && !/^[a-f0-9]{64}$/.test(bundleKey)) throw new Error("Invalid Host bundle key.");
  const location = browserManifestLocation(platform, browser, home, env);
  await access(sourceEntry);
  const speechHelper = join(dirname(sourceEntry), "macos-speech");
  let hasSiri = false;
  if (platform === "darwin") {
    try {
      await access(speechHelper);
      await access(speechHelper + ".swift");
    } catch {
      throw new Error(
        "macOS speech helper not found. Rebuild with pnpm build on macOS, or extract the complete matching Host ZIP.",
      );
    }
    try {
      await access(speechHelper + "-siri");
      hasSiri = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (hasSiri) await access(speechHelper + "-siri.LICENSE");
  }
  const base = installationDir(platform, home, env);
  // Immutable versions avoid replacing running Windows executables during updates.
  const root = bundleKey ? join(base, "versions", bundleKey) : base;
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (bundledRuntime) {
    nodePath = join(root, platform === "win32" ? "node.exe" : "node");
    await (bundleKey ? copyImmutable : atomicCopy)(bundledRuntime, nodePath, 0o700);
  }
  const entry = join(root, "native-host.mjs");
  await (bundleKey ? copyImmutable : atomicCopy)(sourceEntry, entry, 0o600);
  if (platform === "darwin") {
    await (bundleKey ? copyImmutable : atomicCopy)(speechHelper, join(root, "macos-speech"), 0o700);
    await (bundleKey ? copyImmutable : atomicCopy)(
      speechHelper + ".swift",
      join(root, "macos-speech.swift"),
      0o600,
    );
    // Older SDK builds may omit the optional Siri backend. Never retain an old
    // helper when updating an unversioned development installation.
    for (const suffix of ["-siri", "-siri.LICENSE"]) {
      if (hasSiri) {
        await (bundleKey ? copyImmutable : atomicCopy)(
          speechHelper + suffix,
          join(root, "macos-speech" + suffix),
          suffix === "-siri" ? 0o700 : 0o600,
        );
      } else if (!bundleKey) await rm(join(root, "macos-speech" + suffix), { force: true });
    }
  }
  const launcher = await installLauncher(
    platform,
    root,
    sourceRoot,
    entry,
    nodePath,
    home,
    run,
    prebuiltLauncher,
    Boolean(bundleKey),
  );
  const manifest = {
    name: HOST_NAME,
    description: "Local agent host for Contextual Language Learning",
    path: launcher,
    type: "stdio",
    allowed_origins: ["chrome-extension://" + extensionId + "/"],
  };
  const manifestPath =
    location.type === "file" ? location.path : join(base, browser + "-" + HOST_NAME + ".json");
  await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  if (location.type === "registry") {
    // HKCU is per-user; no admin privileges and no global browser setting changes.
    await run("reg.exe", ["add", location.key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], {
      timeout: 20_000,
      maxBuffer: 8192,
      windowsHide: true,
    });
  }
  return { launcher, manifestPath, location };
}

/** Remove one browser registration, retaining the shared program until the last browser is removed. */
export async function uninstallNativeHost({
  platform = process.platform,
  browser = "chrome",
  home = homedir(),
  env = process.env,
  run = exec,
} = {}) {
  const location = browserManifestLocation(platform, browser, home, env);
  const root = installationDir(platform, home, env);
  async function registered(candidate) {
    const entry = browserManifestLocation(platform, candidate, home, env);
    if (entry.type === "file") {
      try {
        await lstat(entry.path);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    }
    // PowerShell returns a boolean, avoiding localized reg.exe error-text matching.
    const path = "Registry::HKEY_CURRENT_USER" + entry.key.slice("HKCU".length);
    const result = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; Test-Path -LiteralPath '" + path + "'",
      ],
      { timeout: 20_000, maxBuffer: 8192, windowsHide: true },
    );
    const value = result.stdout.trim().toLowerCase();
    if (value !== "true" && value !== "false") throw new Error("Could not read Host registration.");
    return value === "true";
  }
  const remainingBrowsers = [];
  // Check all registrations before changing anything; read failures must not erase a shared Host.
  for (const candidate of browsers) {
    if (candidate !== browser && (await registered(candidate))) remainingBrowsers.push(candidate);
  }
  if (location.type === "file") {
    await rm(location.path, { force: true });
  } else if (await registered(browser)) {
    await run("reg.exe", ["delete", location.key, "/f"], {
      timeout: 20_000,
      maxBuffer: 8192,
      windowsHide: true,
    });
  }
  const programRemoved = remainingBrowsers.length === 0;
  if (programRemoved) {
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      if (platform !== "win32" || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      return { location, programRemoved: false, remainingBrowsers, cleanupPending: true };
    }
  }
  return { location, programRemoved, remainingBrowsers };
}
