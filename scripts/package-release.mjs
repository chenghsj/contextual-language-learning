import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDist = join(root, "apps/extension/dist");
const hostRoot = join(root, "apps/local-host");
const hostDist = join(hostRoot, "dist/native-host.mjs");
const installer = join(hostRoot, "scripts/install-host.mjs");
const assetDir = join(root, "release-assets");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/, "Invalid package version");

const manifest = JSON.parse(await readFile(join(extensionDist, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3, "Chromium package must use Manifest V3");
assert.equal(manifest.version, version, "Extension manifest version must match package.json");
assert.ok(!Object.hasOwn(manifest, "key"), "Release manifest must not embed an extension key");
for (const name of ["manifest.json", "sidepanel.html", "background.js", "youtube.js", "netflix.js", "netflix-page.js"]) {
  await access(join(extensionDist, name));
}
await access(hostDist);
await access(installer);

const chromiumName = "immersive-language-learning-chromium-" + version + ".zip";
const hostName = "immersive-language-learning-macos-host-" + version + ".zip";
await rm(assetDir, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), "immersive-release-"));
try {
  // Archive contents of dist, not dist itself: manifest.json must be at archive root.
  await exec("zip", ["-X", "-q", "-r", join(assetDir, chromiumName), ".", "-x", "*.DS_Store"], {
    cwd: extensionDist,
  });
  const hostStage = join(stage, "host");
  await mkdir(join(hostStage, "dist"), { recursive: true });
  await mkdir(join(hostStage, "scripts"), { recursive: true });
  await copyFile(hostDist, join(hostStage, "dist/native-host.mjs"));
  await copyFile(installer, join(hostStage, "scripts/install-host.mjs"));
  await writeFile(join(hostStage, "README.md"), [
    "# Immersive Language Learning — macOS Native Host", "",
    "Requires macOS, Node.js 22+, and at least one installed and signed-in CLI Agent.", "",
    "1. Extract the Chromium ZIP separately and load it through chrome://extensions.",
    "2. Copy the extension ID from Chrome's extension details page.",
    "3. Inside this extracted Host directory run:", "",
    "   node scripts/install-host.mjs YOUR_EXTENSION_ID", "",
    "The installer copies the Host to ~/Library/Application Support/Immersive Learning/native-host/",
    "and registers it for your current Chrome extension ID. You can remove the extraction afterward.",
    "In the Side Panel, open Agent settings and select Check Native Host / CLI.",
    "CLI credentials are never included in this ZIP.", "",
  ].join("\n"));
  await exec("zip", ["-X", "-q", "-r", join(assetDir, hostName), "."], { cwd: hostStage });

  const [chromiumContents, hostContents] = await Promise.all([
    exec("unzip", ["-Z", "-1", join(assetDir, chromiumName)]),
    exec("unzip", ["-Z", "-1", join(assetDir, hostName)]),
  ]);
  const names = output => output.stdout.split(/\r?\n/).map(value => value.replace(/^\.\//, ""));
  assert.ok(names(chromiumContents).includes("manifest.json"), "Chromium ZIP lacks root manifest.json");
  assert.ok(!names(chromiumContents).some(path => path.startsWith("apps/") || path.startsWith("node_modules/")),
    "Chromium ZIP contains unexpected project directories");
  assert.ok(names(hostContents).includes("dist/native-host.mjs"), "Host ZIP lacks compiled Native Host");
  assert.ok(names(hostContents).includes("scripts/install-host.mjs"), "Host ZIP lacks the installer");

  const lines = [];
  for (const name of [chromiumName, hostName]) {
    const digest = createHash("sha256").update(await readFile(join(assetDir, name))).digest("hex");
    lines.push(digest + "  " + name);
  }
  await writeFile(join(assetDir, "SHA256SUMS"), lines.join("\n") + "\n");
  process.stdout.write("Release assets verified:\n" +
    [chromiumName, hostName, "SHA256SUMS"].join("\n") + "\n");
} finally {
  await rm(stage, { recursive: true, force: true });
}
