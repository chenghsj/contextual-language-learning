import assert from "node:assert/strict";
import { buildHostSetup, setupConfiguration } from "./package-host-setup.mjs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
assert.equal(
  extensionManifest.version,
  version,
  "Extension manifest version must match package.json",
);
assert.ok(
  !Object.hasOwn(extensionManifest, "key"),
  "Release manifest must not embed an extension key",
);
for (const name of [
  "manifest.json",
  "sidepanel.html",
  "background.js",
  "youtube.js",
  "netflix.js",
  "netflix-page.js",
]) {
  await access(join(extensionDist, name));
}
for (const size of [16, 32, 48, 128]) {
  const path = "icons/icon" + size + ".png";
  assert.equal(extensionManifest.icons?.[size], path, "Manifest icon missing for " + size);
  assert.equal(
    extensionManifest.action?.default_icon?.[size],
    path,
    "Toolbar icon missing for " + size,
  );
  await access(join(extensionDist, path));
}
await access(hostDist);
const chromiumName = "contextual-language-learning-chromium-" + version + ".zip";
const extensionIds = Object.fromEntries(
  [
    ["chrome", process.env.CLL_CHROME_EXTENSION_ID],
    ["edge", process.env.CLL_EDGE_EXTENSION_ID],
    ["chromium", process.env.CLL_CHROMIUM_EXTENSION_ID],
  ].filter(([, value]) => value),
);
const mode = process.env.CLL_SETUP_MODE === "local" ? "local" : "release";
setupConfiguration({ platform: "darwin", arch: "arm64", version, extensionIds, mode });
const hostNames = [];
await rm(assetDir, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), "cll-release-"));
try {
  // Archive contents of dist, not dist itself: manifest.json must be at archive root.
  await exec("zip", ["-X", "-q", "-r", join(assetDir, chromiumName), ".", "-x", "*.DS_Store"], {
    cwd: extensionDist,
  });
  for (const platform of ["darwin", "win32", "linux"]) {
    for (const arch of ["arm64", "x64"]) {
      process.stdout.write("Building local-service setup: " + platform + " " + arch + "\n");
      const setup = await buildHostSetup({
        platform,
        arch,
        extensionIds,
        mode,
        outputDir: assetDir,
      });
      hostNames.push(setup.path.slice(assetDir.length + 1));
    }
  }

  const archiveNames = [chromiumName, ...hostNames];
  const names = output => output.stdout.split(/\r?\n/).map(value => value.replace(/^\.\//, ""));
  const chromiumContents = names(await exec("unzip", ["-Z", "-1", join(assetDir, chromiumName)]));
  assert.ok(chromiumContents.includes("manifest.json"), "Chromium ZIP lacks root manifest.json");
  for (const size of [16, 32, 48, 128]) {
    assert.ok(
      chromiumContents.includes("icons/icon" + size + ".png"),
      "Chromium ZIP lacks icon" + size + ".png",
    );
  }
  assert.ok(
    !chromiumContents.some(path => path.startsWith("apps/") || path.startsWith("node_modules/")),
    "Chromium ZIP contains unexpected project directories",
  );
  for (const hostName of hostNames) {
    const contents = names(await exec("unzip", ["-Z", "-1", join(assetDir, hostName)]));
    if (hostName.includes("-macos-")) {
      assert.ok(
        contents.some(path => path.endsWith("dist/macos-credentials")),
        hostName + " lacks Keychain helper",
      );
      assert.ok(
        contents.some(path => path.endsWith("dist/macos-speech.swift")),
        hostName + " lacks speech source",
      );
      assert.ok(
        contents.some(path => path.endsWith("dist/macos-speech")),
        hostName + " lacks native speech helper",
      );
    }
    assert.ok(
      contents.some(path => path.endsWith("setup/server.mjs")),
      hostName + " lacks setup UI",
    );
    assert.ok(
      contents.some(path => /runtime\/node(?:\.exe)?$/.test(path)),
      hostName + " lacks bundled runtime",
    );
    assert.ok(
      contents.some(path => path.endsWith("runtime/LICENSE")),
      hostName + " lacks runtime license",
    );
  }

  const lines = [];
  for (const name of archiveNames) {
    const digest = createHash("sha256")
      .update(await readFile(join(assetDir, name)))
      .digest("hex");
    lines.push(digest + "  " + name);
  }
  await writeFile(join(assetDir, "SHA256SUMS"), lines.join("\n") + "\n");
  process.stdout.write(
    "Release assets verified:\n" + [...archiveNames, "SHA256SUMS"].join("\n") + "\n",
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
