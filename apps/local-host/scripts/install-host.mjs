import { randomUUID } from "node:crypto";
import { access, chmod, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionId = process.argv[2];
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  process.stderr.write("Usage: node scripts/install-host.mjs <32-character Chrome extension ID>\n");
  process.exit(1);
}
if (process.platform !== "darwin") {
  process.stderr.write("This Native Host installer currently supports macOS only.\n");
  process.exit(1);
}
if (Number(process.versions.node.split(".")[0]) < 22) {
  process.stderr.write("Node.js 22 or newer is required.\n");
  process.exit(1);
}

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceEntry = resolve(sourceRoot, "dist/native-host.mjs");
await access(sourceEntry);

const installationDir = join(homedir(), "Library/Application Support/Immersive Learning/native-host");
await mkdir(installationDir, { recursive: true, mode: 0o700 });
const entry = join(installationDir, "native-host.mjs");
const temporaryEntry = entry + "." + randomUUID() + ".tmp";
try {
  await copyFile(sourceEntry, temporaryEntry);
  await chmod(temporaryEntry, 0o600);
  await rename(temporaryEntry, entry);
} finally {
  await rm(temporaryEntry, { force: true }).catch(() => undefined);
}

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const searchPath = [
  dirname(process.execPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homedir(), ".local/bin"),
].join(":");
const launcher = join(installationDir, "launch.sh");
const temporaryLauncher = launcher + "." + randomUUID() + ".tmp";
try {
  await writeFile(temporaryLauncher,
    "#!/bin/sh\nexport PATH=" + quote(searchPath) + ":\"$PATH\"\n" +
    "exec " + quote(process.execPath) + " " + quote(entry) + "\n",
    { mode: 0o700, flag: "wx" });
  await chmod(temporaryLauncher, 0o700);
  await rename(temporaryLauncher, launcher);
} finally {
  await rm(temporaryLauncher, { force: true }).catch(() => undefined);
}

const registry = join(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
await mkdir(registry, { recursive: true, mode: 0o700 });
const manifestPath = join(registry, "dev.immersive.language_learning.json");
const temporaryManifest = manifestPath + "." + randomUUID() + ".tmp";
try {
  await writeFile(temporaryManifest, JSON.stringify({
    name: "dev.immersive.language_learning",
    description: "Local agent host for Immersive Language Learning",
    path: launcher,
    type: "stdio",
    allowed_origins: ["chrome-extension://" + extensionId + "/"],
  }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporaryManifest, manifestPath);
} finally {
  await rm(temporaryManifest, { force: true }).catch(() => undefined);
}
process.stdout.write("Installed macOS Native Host for extension " + extensionId + "\n" +
  "Executable: " + entry + "\nManifest: " + manifestPath + "\n");
