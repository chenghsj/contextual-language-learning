import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function buildMacSpeech() {
  if (process.platform !== "darwin") return;
  const exec = promisify(execFile);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const source = join(root, "src/platform/macos-speech.swift");
  const output = join(root, "dist/macos-speech");
  await mkdir(join(root, "dist"), { recursive: true });
  const temporary = await mkdtemp(join(tmpdir(), "cll-speech-build-"));
  try {
    const { stdout } = await exec("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
    const slices = [];
    for (const arch of ["arm64", "x86_64"]) {
      const slice = join(temporary, arch);
      await exec(
        "/usr/bin/xcrun",
        [
          "swiftc",
          "-O",
          "-sdk",
          stdout.trim(),
          "-target",
          arch + "-apple-macosx13.0",
          "-module-cache-path",
          join(temporary, "modules"),
          source,
          "-o",
          slice,
        ],
        { timeout: 120_000 },
      );
      slices.push(slice);
    }
    await exec("/usr/bin/lipo", ["-create", ...slices, "-output", output]);
    await chmod(output, 0o755);
    await exec("/usr/bin/codesign", ["--force", "--sign", "-", output]);
    await copyFile(source, output + ".swift");
    process.stdout.write("Built macOS system speech helper (arm64 + x86_64, macOS 13+).\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildMacSpeech();
