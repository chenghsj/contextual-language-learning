import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installNativeHost } from "./native-host-platform.mjs";

const usage =
  "Usage: node scripts/install-host.mjs <32-character Chromium extension ID> " +
  "[--browser chrome|edge|chromium]\n";
const [extensionId, ...options] = process.argv.slice(2);
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  process.stderr.write(usage);
  process.exit(1);
}
let browser = "chrome";
if (options.length) {
  if (options.length === 2 && options[0] === "--browser") browser = options[1];
  else if (options.length === 1 && options[0].startsWith("--browser=")) {
    browser = options[0].slice("--browser=".length);
  } else {
    process.stderr.write(usage);
    process.exit(1);
  }
}
if (!["darwin", "win32", "linux"].includes(process.platform)) {
  process.stderr.write("Native Host supports macOS, Windows and Linux only.\n");
  process.exit(1);
}
if (Number(process.versions.node.split(".")[0]) < 22) {
  process.stderr.write("Node.js 22 or newer is required.\n");
  process.exit(1);
}

try {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sourceEntry = resolve(sourceRoot, "dist/native-host.mjs");
  await access(sourceEntry);
  const result = await installNativeHost({ extensionId, browser, sourceRoot, sourceEntry });
  process.stdout.write(
    "Installed " +
      process.platform +
      " Native Host for " +
      browser +
      " extension " +
      extensionId +
      "\n" +
      "Launcher: " +
      result.launcher +
      "\nManifest: " +
      result.manifestPath +
      "\n",
  );
} catch (error) {
  process.stderr.write(
    "Native Host installation failed: " +
      (error instanceof Error ? error.message : String(error)) +
      "\n",
  );
  process.exitCode = 1;
}
