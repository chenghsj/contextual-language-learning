import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { messages } from "./messages";

test("the reader UI uses localized messages instead of hardcoded Chinese JSX labels", async () => {
  const source = await readSource(new URL("../App.tsx", import.meta.url));
  assert.doesNotMatch(source, /[\u4e00-\u9fff]/u);
  for (const key of ["uiLanguage", "appearance"]) {
    assert.ok(source.includes(`t("${key}")`), `${key} should be localized`);
  }
});

test("all five Chrome manifest locales contain the required display strings", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../public/manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.action.default_title, "__MSG_actionTitle__");
  for (const origin of [
    "https://*.nflxvideo.net/*",
    "https://*.nflximg.net/*",
    "https://*.nflxext.com/*",
  ]) {
    assert.ok(
      manifest.host_permissions.includes(origin),
      "Missing caption CDN permission: " + origin,
    );
  }
  for (const locale of ["en", "zh_TW", "zh_CN", "ja", "ko"]) {
    const file = new URL(`../../public/_locales/${locale}/messages.json`, import.meta.url);
    const catalog = JSON.parse(await readFile(file, "utf8"));
    for (const key of ["extensionName", "extensionDescription", "actionTitle"]) {
      assert.ok(catalog[key]?.message?.trim(), `${locale}: missing ${key}`);
    }
  }
  assert.deepEqual(Object.keys(messages).sort(), ["en", "ja", "ko", "zh-CN", "zh-TW"].sort());
});

test("YouTube one-click caption UI has a page-world reader in the manifest", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../public/manifest.json", import.meta.url), "utf8"),
  );
  assert.ok(
    manifest.content_scripts.some(
      (script: { world?: string; run_at?: string; js: string[] }) =>
        script.world === "MAIN" &&
        script.run_at === "document_start" &&
        script.js.includes("youtube-page.js"),
    ),
  );
});

test("failed generation updates the progress status and refreshing tasks preserves its error", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  assert.match(app, /function jobStatusLine\(summary: JobSummary\)/);
  assert.match(app, /lastJobSummaryRef\.current = summary;/);
  assert.match(
    app,
    /const current = message\.jobs\.find\(job => job\.id === lastJobIdRef\.current\);/,
  );
  const load = app.slice(
    app.indexOf("function loadJobs(): void"),
    app.indexOf("function fetchSavedDocument("),
  );
  assert.doesNotMatch(load, /setError\(" "\)|setError\(""\)/);
});
