import { uninstallNativeHost } from "./native-host-platform.mjs";

const usage = "Usage: node scripts/uninstall-host.mjs [--browser chrome|edge|chromium]\n";
const options = process.argv.slice(2);
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
if (!["chrome", "edge", "chromium"].includes(browser)) {
  process.stderr.write(usage);
  process.exit(1);
}
try {
  const result = await uninstallNativeHost({ browser });
  process.stdout.write(
    "Removed Native Host registration for " +
      browser +
      ".\n" +
      (result.programRemoved
        ? "Removed the Host program.\n"
        : "Kept the shared Host program for: " + result.remainingBrowsers.join(", ") + ".\n") +
      "Lessons, task history, credentials and settings were preserved.\n",
  );
} catch (error) {
  process.stderr.write(
    "Native Host uninstall failed: " +
      (error instanceof Error ? error.message : String(error)) +
      "\n",
  );
  process.exitCode = 1;
}
