import assert from "node:assert/strict";
import test from "node:test";
import { messages, translate } from "./messages";
import { isLocalePreference, isThemePreference, localeFromBrowser, resolveTheme } from "./preferences";

test("browser language resolves Chinese script and supported locales", () => {
  assert.equal(localeFromBrowser("zh-TW"), "zh-TW");
  assert.equal(localeFromBrowser("zh-HK"), "zh-TW");
  assert.equal(localeFromBrowser("zh-Hant"), "zh-TW");
  assert.equal(localeFromBrowser("zh-CN"), "zh-CN");
  assert.equal(localeFromBrowser("zh-Hans-SG"), "zh-CN");
  assert.equal(localeFromBrowser("ja-JP"), "ja");
  assert.equal(localeFromBrowser("ko-KR"), "ko");
  assert.equal(localeFromBrowser("en-US"), "en");
  assert.equal(localeFromBrowser("fr-FR"), "en");
});
test("all supported languages have the same keys and replace interpolation tokens", () => {
  const expected = Object.keys(messages.en).sort();
  for (const [locale, catalog] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(catalog).sort(), expected, locale);
  }
  assert.equal(translate("ja", "parsedCues", { count: 3 }), "3 件の字幕を解析しました。");
  assert.equal(translate("en", "jobProgress",
    { provider: "Codex", status: "Running", completed: 1, total: 3 }), "Codex · Running · 1 / 3 sections");
});
test("theme and locale overrides accept supported values only", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(isLocalePreference("auto"), true);
  assert.equal(isLocalePreference("fr"), false);
  assert.equal(isThemePreference("system"), true);
  assert.equal(isThemePreference("sepia"), false);
});
