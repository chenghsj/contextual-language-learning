import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeVersion = "22.23.3";
// Official Node distribution digests; update together when refreshing the runtime.
const digests = {
  "darwin-arm64": "23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53",
  "darwin-x64": "8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8",
  "linux-arm64": "5ced2d48d1d7198739b7f86804de0171aefb6823b684b12341d3321afc3cb0b2",
  "linux-x64": "1084aa36196bba4c3a5e69a1ee388a6e4ff729dad09445fbcd434b28fe3c24af",
  "win32-arm64": "33dad22e4cef5ee8f9fbb1b0d037fdacd0e56d12a4580f0d63f68b894deab535",
  "win32-x64": "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71",
};
const platformNames = { darwin: "macos", win32: "windows", linux: "linux" };
const psQuote = value => "\'" + value.replaceAll("\'", "\'\'") + "\'";
const validId = value => typeof value === "string" && /^[a-p]{32}$/.test(value);

export function setupConfiguration({ platform, arch, version, extensionIds, mode = "release" }) {
  if (!digests[platform + "-" + arch])
    throw new Error("Unsupported setup target: " + platform + "-" + arch);
  if (
    !extensionIds ||
    !Object.values(extensionIds).some(validId) ||
    Object.entries(extensionIds).some(
      ([browser, id]) => !["chrome", "edge", "chromium"].includes(browser) || !validId(id),
    )
  ) {
    throw new Error(
      "Set the real browser extension IDs, or use --extension-id for a local test package.",
    );
  }
  if (!["local", "release"].includes(mode)) throw new Error("Invalid setup mode");
  return { platform, arch, version, extensionIds, mode, nodeVersion };
}

async function downloadRuntime(platform, arch, temporary) {
  const target = (platform === "win32" ? "win" : platform) + "-" + arch;
  const basename = `node-v${nodeVersion}-${target}`;
  const filename = basename + (platform === "win32" ? ".zip" : ".tar.gz");
  const cache = join(project, ".cache/host-runtime");
  await mkdir(cache, { recursive: true });
  const archive = join(cache, filename);
  try {
    await access(archive);
  } catch {
    const response = await fetch(`https://nodejs.org/dist/v${nodeVersion}/${filename}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error("Node runtime download failed: " + response.status);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
  }
  const hash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (hash !== digests[platform + "-" + arch]) {
    await rm(archive, { force: true });
    throw new Error("Node runtime SHA256 verification failed: " + filename);
  }
  if (platform === "win32") {
    if (process.platform === "win32") {
      await exec("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Expand-Archive -LiteralPath " +
          psQuote(archive) +
          " -DestinationPath " +
          psQuote(temporary),
      ]);
    } else await exec("unzip", ["-q", archive, "-d", temporary]);
  } else await exec("tar", ["-xzf", archive, "-C", temporary]);
  return {
    node: join(temporary, basename, platform === "win32" ? "node.exe" : "bin/node"),
    license: join(temporary, basename, "LICENSE"),
  };
}

async function compileWindows(source, output, gui = false) {
  if (process.platform === "win32") {
    const compiler = join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    await exec(compiler, [
      "/nologo",
      gui ? "/target:winexe" : "/target:exe",
      ...(gui ? ["/reference:System.Windows.Forms.dll"] : []),
      "/out:" + output,
      source,
    ]);
  } else if (
    process.env.CLL_CSC_DOTNET &&
    process.env.CLL_CSC_DLL &&
    process.env.CLL_FRAMEWORK_REFERENCES
  ) {
    const references = [
      "mscorlib",
      "System",
      "System.Core",
      ...(gui ? ["System.Windows.Forms", "System.Drawing"] : []),
    ];
    await exec(
      process.env.CLL_CSC_DOTNET,
      [
        process.env.CLL_CSC_DLL,
        "-nologo",
        "-noconfig",
        "-nostdlib+",
        gui ? "-target:winexe" : "-target:exe",
        ...references.map(
          name => "-r:" + join(process.env.CLL_FRAMEWORK_REFERENCES, name + ".dll"),
        ),
        "-out:" + output,
        source,
      ],
      {
        env: {
          ...process.env,
          DOTNET_CLI_HOME: join(project, ".cache/host-runtime/dotnet-home"),
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_NOLOGO: "1",
        },
      },
    );
  } else {
    // Development/build dependency only; the user's computer never compiles code.
    await exec("mcs", [
      gui ? "-target:winexe" : "-target:exe",
      ...(gui ? ["-r:System.Windows.Forms"] : []),
      "-out:" + output,
      source,
    ]);
  }
}

export async function buildHostSetup(options) {
  const { version } = JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  const config = setupConfiguration({ version, ...options });
  const outputDir = options.outputDir ?? join(project, "release-assets");
  await mkdir(outputDir, { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "cll-setup-build-"));
  try {
    const stage = join(temporary, "stage");
    const app = join(stage, "CLL 本機服務.app");
    const root = config.platform === "darwin" ? join(app, "Contents/Resources") : stage;
    await mkdir(root, { recursive: true });
    for (const folder of ["runtime", "dist", "scripts", "setup"]) await mkdir(join(root, folder));
    const runtime = await downloadRuntime(config.platform, config.arch, temporary);
    const speechHelper =
      config.platform === "darwin"
        ? await readFile(join(project, "apps/local-host/dist/macos-speech"))
        : Buffer.alloc(0);
    const speechSource =
      config.platform === "darwin"
        ? await readFile(join(project, "apps/local-host/dist/macos-speech.swift"))
        : Buffer.alloc(0);
    const credentialHelper =
      config.platform === "darwin"
        ? await readFile(join(project, "apps/local-host/dist/macos-credentials"))
        : Buffer.alloc(0);
    const siriHelper =
      config.platform === "darwin"
        ? await readFile(join(project, "apps/local-host/dist/macos-speech-siri")).catch(error => {
            if (error.code === "ENOENT") return Buffer.alloc(0);
            throw error;
          })
        : Buffer.alloc(0);
    const siriLicense = siriHelper.length
      ? await readFile(join(project, "apps/local-host/dist/macos-speech-siri.LICENSE"))
      : Buffer.alloc(0);
    config.revision = createHash("sha256")
      .update(await readFile(join(project, "apps/local-host/dist/native-host.mjs")))
      .update(speechHelper)
      .update(speechSource)
      .update(credentialHelper)
      .update(siriHelper)
      .update(siriLicense)
      .update(await readFile(join(project, "apps/local-host/scripts/windows-launcher.cs")))
      .update(nodeVersion + config.platform + config.arch)
      .digest("hex");
    const runtimePath = join(root, "runtime", config.platform === "win32" ? "node.exe" : "node");
    await copyFile(runtime.node, runtimePath);
    await chmod(runtimePath, 0o755);
    await copyFile(runtime.license, join(root, "runtime/LICENSE"));
    await copyFile(
      join(project, "apps/local-host/dist/native-host.mjs"),
      join(root, "dist/native-host.mjs"),
    );
    if (config.platform === "darwin") {
      await writeFile(join(root, "dist/macos-credentials"), credentialHelper, { mode: 0o755 });
      await writeFile(join(root, "dist/macos-speech"), speechHelper, { mode: 0o755 });
      await writeFile(join(root, "dist/macos-speech.swift"), speechSource, { mode: 0o644 });
      if (siriHelper.length) {
        await writeFile(join(root, "dist/macos-speech-siri"), siriHelper, { mode: 0o755 });
        await writeFile(join(root, "dist/macos-speech-siri.LICENSE"), siriLicense, { mode: 0o644 });
      }
    }
    await copyFile(
      join(project, "apps/local-host/scripts/native-host-platform.mjs"),
      join(root, "scripts/native-host-platform.mjs"),
    );
    for (const file of ["server.mjs", "index.html"])
      await copyFile(join(project, "apps/local-host/setup", file), join(root, "setup", file));
    await writeFile(join(root, "setup-config.json"), JSON.stringify(config, null, 2) + "\n");
    if (config.platform === "darwin") {
      await mkdir(join(app, "Contents/MacOS"));
      await writeFile(
        join(app, "Contents/Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Setup</string><key>CFBundleIdentifier</key><string>dev.contextual.language-learning.setup</string><key>CFBundleName</key><string>CLL 本機服務</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${version}</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>`,
      );
      await writeFile(
        join(app, "Contents/MacOS/Setup"),
        '#!/bin/sh\nSETUP_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../Resources" && pwd)"\nexec "$SETUP_ROOT/runtime/node" "$SETUP_ROOT/setup/server.mjs" "$@"\n',
        { mode: 0o755 },
      );
    } else if (config.platform === "win32") {
      await compileWindows(
        join(project, "apps/local-host/setup/windows-setup.cs"),
        join(root, "Setup.exe"),
        true,
      );
      await compileWindows(
        join(project, "apps/local-host/scripts/windows-launcher.cs"),
        join(root, "native-host.exe"),
      );
    } else {
      await writeFile(
        join(root, "CLL Setup"),
        '#!/bin/sh\nSETUP_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$SETUP_ROOT/runtime/node" "$SETUP_ROOT/setup/server.mjs" "$@"\n',
        { mode: 0o755 },
      );
      // Desktop Entry values are unescaped before Exec arguments are unquoted.
      const command = 'exec "$(dirname "$1")/CLL Setup"'
        .replace(/[\\"`$]/g, character => "\\" + character)
        .replaceAll("\\", "\\\\");
      await writeFile(
        join(root, "CLL Setup.desktop"),
        `[Desktop Entry]\nType=Application\nName=CLL Local Service\nName[zh_TW]=CLL 本機服務\nExec=/bin/sh -c "${command}" cll-setup %k\nTerminal=false\nIcon=preferences-system\nCategories=Utility;\n`,
        { mode: 0o755 },
      );
    }
    await writeFile(
      join(stage, "請先閱讀.txt"),
      [
        "Contextual Language Learning · 本機服務 " + version,
        config.mode === "local" ? "本機測試版：已預先設定測試擴充功能 ID。" : "正式安裝版。",
        "",
        "1. 完整解壓縮 ZIP。",
        "2. 雙擊「" +
          (config.platform === "darwin"
            ? "CLL 本機服務.app"
            : config.platform === "win32"
              ? "Setup.exe"
              : "CLL Setup.desktop") +
          "」，在開啟的設定頁選擇瀏覽器並按「安裝本機服務」。",
        "3. 回到擴充功能，按「檢查連線」。",
        "",
        "不需要安裝 Node.js、下載專案或執行終端機指令。",
        "更新與解除安裝：再次開啟相同設定程式。請先等待任務完成。",
        "解除安裝保留教材、設定與登入資料；其他瀏覽器的註冊也會保留。",
        config.mode === "local"
          ? "此本機測試包尚未簽章／公證；正式發佈前必須完成平台驗收及簽章。"
          : "",
        config.platform === "linux"
          ? "Linux 需要圖形桌面與 xdg-open。首次開啟時，依桌面提示選擇「允許啟動」；此 ZIP 尚不是發行版套件。"
          : "",
        "",
      ].join("\n"),
    );
    const filename = `contextual-language-learning-${platformNames[config.platform]}-${config.arch}-setup-${version}${config.mode === "local" ? "-local" : ""}.zip`;
    const path = join(outputDir, filename);
    await rm(path, { force: true });
    if (process.platform === "win32") {
      await exec("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Compress-Archive -Path " +
          psQuote(join(stage, "*")) +
          " -DestinationPath " +
          psQuote(path),
      ]);
    } else await exec("zip", ["-X", "-q", "-r", path, ".", "-x", "*.DS_Store"], { cwd: stage });
    const sha256 = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    await writeFile(path + ".sha256", sha256 + "  " + filename + "\n");
    return { path, sha256, config };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = key => {
    const index = args.indexOf(key);
    return index < 0 ? undefined : args[index + 1];
  };
  const id = get("--extension-id");
  const extensionIds = id
    ? { chrome: id, edge: id, chromium: id }
    : Object.fromEntries(
        [
          ["chrome", process.env.CLL_CHROME_EXTENSION_ID],
          ["edge", process.env.CLL_EDGE_EXTENSION_ID],
          ["chromium", process.env.CLL_CHROMIUM_EXTENSION_ID],
        ].filter(([, value]) => value),
      );
  const result = await buildHostSetup({
    platform: get("--platform") ?? process.platform,
    arch: get("--arch") ?? process.arch,
    extensionIds,
    mode: id ? "local" : "release",
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
