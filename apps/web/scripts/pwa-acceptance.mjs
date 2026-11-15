import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { chromium } from "../../extension/node_modules/playwright/index.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = fileURLToPath(new URL("../../../.audit/web-pwa/", import.meta.url));
const address = process.argv[2];
const server = address
  ? null
  : await preview({
      root,
      configFile: join(root, "vite.config.ts"),
      preview: { host: "localhost", port: 0 },
    });
const profile = await mkdtemp(join(tmpdir(), "cll-pwa-installability-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true });
  const page = context.pages()[0];
  await page.goto(address ?? server.resolvedUrls.local[0]);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const cdp = await context.newCDPSession(page);
  const result = await cdp.send("Page.getAppManifest");
  assert.equal(result.errors.filter(error => error.critical).length, 0);
  const manifest = JSON.parse(result.data);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  const errors = (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors;
  assert.deepEqual(
    errors,
    [],
    "Chromium reports no PWA installability errors in a non-incognito profile",
  );
  await cdp.detach();
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, page.url()).href);
    assert.ok(response.ok());
    const png = await response.body();
    assert.equal(icon.sizes, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
  }
  await mkdir(out, { recursive: true });
  await writeFile(
    out + "installability-result.json",
    JSON.stringify(
      {
        url: page.url(),
        installabilityErrors: errors,
        manifest: true,
        icons: true,
        installed: false,
      },
      null,
      2,
    ),
  );
  console.log("PASS PWA manifest, icon dimensions and Chromium installability; no app installed");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
