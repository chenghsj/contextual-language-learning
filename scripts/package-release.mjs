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
const assetDir = join(root, "release-assets");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/, "Invalid package version");

const extensionManifest = JSON.parse(await readFile(join(extensionDist, "manifest.json"), "utf8"));
assert.equal(extensionManifest.manifest_version, 3, "Chromium package must use Manifest V3");
assert.equal(extensionManifest.version, version, "Extension manifest version must match package.json");
assert.ok(!Object.hasOwn(extensionManifest, "key"), "Release manifest must not embed an extension key");
for (const name of ["manifest.json", "sidepanel.html", "background.js", "youtube.js", "netflix.js", "netflix-page.js"]) {
  await access(join(extensionDist, name));
}
for (const size of [16, 32, 48, 128]) {
  const path = "icons/icon" + size + ".png";
  assert.equal(extensionManifest.icons?.[size], path, "Manifest icon missing for " + size);
  assert.equal(extensionManifest.action?.default_icon?.[size], path,
    "Toolbar icon missing for " + size);
  await access(join(extensionDist, path));
}
await access(hostDist);
const installerFiles = ["install-host.mjs", "native-host-platform.mjs", "windows-launcher.cs", "compile-launcher.ps1"];
for (const name of installerFiles) await access(join(hostRoot, "scripts", name));

const chromiumName = "immersive-language-learning-chromium-" + version + ".zip";
const platforms = ["macos", "windows", "linux"];
const hostNames = platforms.map(platform =>
  "immersive-language-learning-" + platform + "-host-" + version + ".zip");
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
  for (const name of installerFiles) {
    await copyFile(join(hostRoot, "scripts", name), join(hostStage, "scripts", name));
  }

  for (let index = 0; index < platforms.length; index++) {
    const platform = platforms[index];
    const hostName = hostNames[index];
    await writeFile(join(hostStage, "README.md"), [
      "# AI-powered Contextual Language Learning — " + platform + " Native Host", "",
      "Requires Node.js 22+, at least one installed and signed-in CLI Agent,",
      "and the matching Chromium extension. Windows additionally requires Windows PowerShell 5.1",
      "and .NET Framework to compile the small launcher executable during installation.", "",
      "1. Extract the Chromium ZIP separately and load it from chrome://extensions",
      "   (or edge://extensions for Edge).",
      "2. Copy the extension's 32-character ID from the browser's extensions page.",
      "3. Inside this extracted Host directory run:", "",
      "   node scripts/install-host.mjs YOUR_EXTENSION_ID",
      "",
      "For Edge: add --browser edge. For Chromium: add --browser chromium.",
      "The installer copies the Host to a stable user directory and registers",
      "Native Messaging for the selected browser. It requires no administrator rights.",
      "Use the same extension ID in the Host installer as the loaded extension.",
      "On Windows, the installed native-host.exe is a locally compiled stdio proxy",
      "to the installed Node runtime; do not point Chrome's manifest at a .cmd file.",
      "On Linux, install zenity or kdialog for the native folder picker.",
      "Google Drive OAuth and Keychain storage remain macOS-only and experimental.",
      "CLI credentials are never included in this ZIP.", "",
    ].join("\n"));
    await exec("zip", ["-X", "-q", "-r", join(assetDir, hostName), "."], { cwd: hostStage });
  }

  const archiveNames = [chromiumName, ...hostNames];
  const names = output => output.stdout.split(/\r?\n/).map(value => value.replace(/^\.\//, ""));
  const chromiumContents = names(await exec("unzip", ["-Z", "-1", join(assetDir, chromiumName)]));
  assert.ok(chromiumContents.includes("manifest.json"), "Chromium ZIP lacks root manifest.json");
  for (const size of [16, 32, 48, 128]) {
    assert.ok(chromiumContents.includes("icons/icon" + size + ".png"),
      "Chromium ZIP lacks icon" + size + ".png");
  }
  assert.ok(!chromiumContents.some(path => path.startsWith("apps/") || path.startsWith("node_modules/")),
    "Chromium ZIP contains unexpected project directories");
  for (const hostName of hostNames) {
    const contents = names(await exec("unzip", ["-Z", "-1", join(assetDir, hostName)]));
    for (const path of ["dist/native-host.mjs", ...installerFiles.map(name => "scripts/" + name)]) {
      assert.ok(contents.includes(path), hostName + " lacks " + path);
    }
  }
  const lines = [];
  for (const name of archiveNames) {
    const digest = createHash("sha256").update(await readFile(join(assetDir, name))).digest("hex");
    lines.push(digest + "  " + name);
  }
  await writeFile(join(assetDir, "SHA256SUMS"), lines.join("\n") + "\n");
  process.stdout.write("Release assets verified:\n" +
    [...archiveNames, "SHA256SUMS"].join("\n") + "\n");
} finally {
  await rm(stage, { recursive: true, force: true });
}
