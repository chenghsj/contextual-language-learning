import assert from "node:assert/strict";
import test from "node:test";
import { messages, translate } from "./messages";
import {
  isLocalePreference,
  isThemePreference,
  localeFromBrowser,
  nativeLanguageName,
  resolveTheme,
  learningLanguageName,
  learningLanguageOptions,
  explanationLanguageName,
} from "./preferences";
import { LEARNING_LANGUAGES } from "@immersive/core";

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
  assert.equal(
    translate("en", "jobProgress", {
      provider: "Codex",
      status: "Running",
      completed: 1,
      total: 3,
    }),
    "Codex · Running · 1 / 3 steps",
  );
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

test("language options always use each language's own name regardless of UI locale", () => {
  assert.equal(nativeLanguageName("en"), "English");
  assert.equal(nativeLanguageName("ja"), "日本語");
  assert.equal(nativeLanguageName("ko"), "한국어");
  assert.equal(nativeLanguageName("zh-TW"), "繁體中文");
  assert.equal(nativeLanguageName("zh-CN"), "简体中文");
});

test("study language names follow the selected interface locale; interface preference names stay native", () => {
  assert.equal(learningLanguageName("en", "zh-TW"), "英語");
  assert.equal(learningLanguageName("ja", "zh-TW"), "日語");
  assert.equal(learningLanguageName("ko", "zh-TW"), "韓語");
  assert.equal(learningLanguageName("es", "zh-TW"), "西班牙語");
  assert.equal(learningLanguageName("es", "ja"), "スペイン語");
  assert.equal(learningLanguageName("es", "en"), "Spanish");
  assert.equal(explanationLanguageName("zh-CN", "zh-TW"), "簡體中文");
  assert.equal(explanationLanguageName("ja", "en"), "Japanese");
  assert.equal(nativeLanguageName("ja"), "日本語");
  assert.equal(isLocalePreference("es"), false);
  for (const language of LEARNING_LANGUAGES) {
    for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
      assert.ok(learningLanguageName(language, locale).length > 1);
    }
  }
});

test("learning-language choices include every supported language once and sort in the interface locale", () => {
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    const options = learningLanguageOptions(locale);
    assert.deepEqual(new Set(options.map(option => option.value)), new Set(LEARNING_LANGUAGES));
    const collator = new Intl.Collator(locale);
    assert.deepEqual(
      options.map(option => option.label),
      [...options]
        .sort((a, b) => collator.compare(a.label, b.label) || a.value.localeCompare(b.value))
        .map(option => option.label),
    );
  }
});
