import test from "node:test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { piBundlePlugin, piRequireBanner } from "./pi-bundle.mjs";

test("standalone SDK bundle estimates and generates without node_modules and includes cancellable OAuth", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-pi-bundle-"));
  try {
    const entries = [
      "agents/pi.test",
      "agents/provider-registry.test",
      "generation/input-estimate.test",
    ];
    await build({
      entryPoints: entries.map(name =>
        fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)),
      ),
      outdir: root,
      outExtension: { ".js": ".mjs" },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      banner: { js: piRequireBanner },
      plugins: [piBundlePlugin],
      logLevel: "silent",
    });
    await promisify(execFile)(
      process.execPath,
      ["--test", ...entries.map(name => join(root, `${name}.mjs`))],
      { cwd: root, timeout: 30000 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
