import { cp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
// Build Output v0, consumed by cf CLI 1.0.0-beta.9.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = root + ".cloudflare/output/v0/";
await rm(output, { recursive: true, force: true });
await mkdir(output + "workers/default", { recursive: true });
await cp(root + "dist", output + "workers/default/assets", { recursive: true });
await writeFile(output + "config.json", JSON.stringify({ buildContext: { isPreview: false } }));
await writeFile(
  output + "workers/default/worker.config.json",
  JSON.stringify({
    name: "contextual-favorites-preview",
    compatibilityDate: "2026-10-23",
    assets: { notFoundHandling: "single-page-application" },
  }),
);
