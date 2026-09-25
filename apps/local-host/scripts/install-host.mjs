import { mkdir, writeFile, chmod, access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionId = process.argv[2];
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  process.stderr.write("Usage: pnpm host:install <32-character Chrome extension ID>\n");
  process.exit(1);
}
if (process.platform !== "darwin") {
  process.stderr.write("This installer currently supports macOS only.\n");
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "dist/native-host.mjs");
await access(entry);
const launcher = resolve(root, "dist/launch.sh");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const searchPath = [
  dirname(process.execPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  join(homedir(), ".local/bin"),
].join(":");
const content = "#!/bin/sh\nexport PATH=" + quote(searchPath) + ":$PATH\nexec " + quote(process.execPath) + " " + quote(entry) + "\n";
await writeFile(launcher, content);
await chmod(launcher, 0o755);
const folder = join(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
await mkdir(folder, { recursive: true });
const manifestPath = join(folder, "dev.immersive.language_learning.json");
await writeFile(manifestPath, JSON.stringify({
  name: "dev.immersive.language_learning",
  description: "Local agent host for Immersive Language Learning",
  path: launcher,
  type: "stdio",
  allowed_origins: ["chrome-extension://" + extensionId + "/"],
}, null, 2) + "\n");
process.stdout.write("Installed native host for extension " + extensionId + "\n" + manifestPath + "\n");
