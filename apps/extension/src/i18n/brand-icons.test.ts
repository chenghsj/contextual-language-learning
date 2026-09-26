import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("manifest and toolbar icons reference actual transparent PNG assets from the latest icon PR", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../public/manifest.json", import.meta.url), "utf8"));
  for (const size of [16, 32, 48, 128]) {
    const path = "icons/icon" + size + ".png";
    assert.equal(manifest.icons[size], path);
    assert.equal(manifest.action.default_icon[size], path);
    const bytes = await readFile(new URL("../../public/" + path, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test("Side Panel and OAuth callback use the brand asset rather than IL placeholder", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const html = await readFile(new URL("../../sidepanel.html", import.meta.url), "utf8");
  const callback = await readFile(new URL("../../../local-host/src/drive/oauth-callback-page.ts", import.meta.url), "utf8");
  assert.match(app, /chrome\.runtime\.getURL\("icons\/icon48\.png"\)/);
  assert.doesNotMatch(app, /<span className="brandMark">IL<\/span>/);
  assert.match(html, /href="\/icons\/icon32\.png"/);
  assert.match(callback, /const BRAND_ICON = "data:image\/png;base64,/);
  assert.doesNotMatch(callback, /<span class="brand-mark" aria-hidden="true">IL<\/span>/);
});
