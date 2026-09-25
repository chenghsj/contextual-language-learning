import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { messages } from "./messages";

test("the reader UI uses localized messages instead of hardcoded Chinese JSX labels", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /[\u4e00-\u9fff]/u);
  for (const key of ["uiLanguage", "appearance", "openOrFocusVideo", "playbackRateLabel"]) {
    assert.ok(source.includes(`t("${key}")`), `${key} should be localized`);
  }
});

test("all five Chrome manifest locales contain the required display strings", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../public/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(manifest.action.default_title, "__MSG_actionTitle__");
  for (const locale of ["en", "zh_TW", "zh_CN", "ja", "ko"]) {
    const file = new URL(`../../public/_locales/${locale}/messages.json`, import.meta.url);
    const catalog = JSON.parse(await readFile(file, "utf8"));
    for (const key of ["extensionName", "extensionDescription", "actionTitle"]) {
      assert.ok(catalog[key]?.message?.trim(), `${locale}: missing ${key}`);
    }
  }
  assert.deepEqual(Object.keys(messages).sort(), ["en", "ja", "ko", "zh-CN", "zh-TW"].sort());
});
