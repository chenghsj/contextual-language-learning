import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function buildMacSiri() {
  if (process.platform !== "darwin") return;
  const exec = promisify(execFile);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = join(root, "src/platform/siri");
  const dist = join(root, "dist");
  const output = join(dist, "macos-speech-siri");
  const { stdout: version } = await exec("/usr/bin/xcrun", [
    "--sdk",
    "macosx",
    "--show-sdk-version",
  ]);
  if (Number(version.trim().split(".")[0]) < 26) {
    await rm(output, { force: true });
    process.stdout.write(
      "Siri helper requires the macOS 26+ SDK; public system speech remains available.\n",
    );
    return;
  }
  const { stdout } = await exec("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
  const frameworks = join(stdout.trim(), "System/Library/PrivateFrameworks");
  const temporary = await mkdtemp(join(tmpdir(), "cll-siri-build-"));
  await mkdir(dist, { recursive: true });
  try {
    await exec(
      "/usr/bin/xcrun",
      [
        "swiftc",
        "-O",
        "-swift-version",
        "5",
        "-sdk",
        stdout.trim(),
        "-target",
        "arm64-apple-macosx26.0",
        "-module-cache-path",
        join(temporary, "modules"),
        "-I",
        join(source, "PrivateInterfaces"),
        "-F",
        frameworks,
        "-Xlinker",
        "-weak_framework",
        "-Xlinker",
        "SiriTTSService",
        // sirittsd requires a stable client identity for voice subscriptions.
        // Embed it in the executable so installation paths need no .app bundle.
        "-Xlinker",
        "-sectcreate",
        "-Xlinker",
        "__TEXT",
        "-Xlinker",
        "__info_plist",
        "-Xlinker",
        join(source, "Info.plist"),
        ...["main.swift", "SiriAudioNormalizer.swift", "OneShotAudioInput.swift"].map(file =>
          join(source, file),
        ),
        "-o",
        output,
      ],
      { timeout: 120_000 },
    );
    await chmod(output, 0o755);
    await exec("/usr/bin/codesign", ["--force", "--sign", "-", output]);
    await copyFile(join(source, "LICENSE"), output + ".LICENSE");
    process.stdout.write("Built Siri speech helper (Apple Silicon, macOS 26+).\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildMacSiri();
