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

test("contextual-learning brand stays consistent across Chrome locales, panel and packaged Host", async () => {
  const names: Record<string, string> = {
    en: "AI-powered Contextual Language Learning",
    ja: "AIで学ぶ文脈型語学学習",
    ko: "AI 기반 맥락 중심 언어 학습",
    zh_CN: "AI 辅助情境式语言学习",
    zh_TW: "AI 輔助情境式語言學習",
  };
  for (const [locale, name] of Object.entries(names)) {
    const catalog = JSON.parse(await readFile(new URL("../../public/_locales/" + locale + "/messages.json", import.meta.url), "utf8"));
    assert.equal(catalog.extensionName.message, name);
    assert.ok(catalog.actionTitle.message.includes(name), locale + " toolbar label");
    assert.ok(catalog.extensionDescription.message.length > 20, locale + " contextual description");
  }
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  const html = await readFile(new URL("../../sidepanel.html", import.meta.url), "utf8");
  const readme = await readFile(new URL("../../../../README.md", import.meta.url), "utf8");
  const packaging = await readFile(new URL("../../../../scripts/package-release.mjs", import.meta.url), "utf8");
  assert.ok(app.includes("<strong>AI-powered Contextual Language Learning</strong>"));
  assert.ok(html.includes("<title>AI-powered Contextual Language Learning</title>"));
  assert.ok(readme.startsWith("# AI-powered Contextual Language Learning"));
  assert.ok(packaging.includes("# AI-powered Contextual Language Learning — "));
});
