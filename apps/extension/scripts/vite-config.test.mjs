import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadConfigFromFile, resolveConfig } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

test("preview optimization cannot replace the running extension dependency cache", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "cll-vite-config-"));
  try {
    await writeFile(join(temporary, "package.json"), "{}\n");
    const environment = { command: "serve", mode: "development" };
    const extension = await loadConfigFromFile(environment, join(root, "vite.dev.config.ts"));
    const preview = await loadConfigFromFile(environment, join(root, "vite.config.ts"));
    assert.ok(extension && preview);
    const resolveCache = config =>
      resolveConfig(
        {
          root: temporary,
          configFile: false,
          plugins: [],
          cacheDir: config.cacheDir,
        },
        "serve",
      );
    const extensionCache = await resolveCache(extension.config);
    const previewCache = await resolveCache(preview.config);
    assert.notEqual(extensionCache.cacheDir, previewCache.cacheDir);
    assert.notEqual(extension.config.build.outDir, preview.config.build.outDir);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
