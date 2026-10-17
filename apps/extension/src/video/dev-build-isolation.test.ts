import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";

const extensionRoot = fileURLToPath(new URL("../../", import.meta.url));
const configPath = fileURLToPath(new URL("../../vite.dev.config.ts", import.meta.url));

test("a build cannot replace the files of the loaded HMR extension", async () => {
  await assert.rejects(
    loadConfigFromFile(
      { command: "build", mode: "production" },
      configPath,
      extensionRoot,
      "silent",
    ),
    /Use pnpm --filter @contextual\/extension build/,
  );
});

test("the development server still writes the unpacked HMR extension", async () => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "development" },
    configPath,
    extensionRoot,
    "silent",
  );
  assert.equal(loaded?.config.build?.outDir, "dist-dev");
  assert.equal(loaded?.config.server?.port, 5174);
});
