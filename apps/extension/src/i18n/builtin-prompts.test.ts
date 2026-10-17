import assert from "node:assert/strict";
import test from "node:test";
import { builtinPrompt, identifyBuiltinPrompt, type BuiltinPromptKey } from "./builtin-prompts";
import { promptTemplates } from "./custom-content";
import type { UiLocale } from "./messages";

test("all built-in Prompts and output-language instructions are localized in all five locales", () => {
  const locales: UiLocale[] = ["en", "zh-TW", "zh-CN", "ja", "ko"];
  const endings = [
    "Write in English.",
    "請使用繁體中文撰寫。",
    "请使用简体中文撰写。",
    "日本語で書いてください。",
    "한국어로 작성해 주세요.",
  ];
  for (const key of Object.keys(promptTemplates) as BuiltinPromptKey[]) {
    const values = new Set<string>();
    for (const [index, locale] of locales.entries()) {
      const value = builtinPrompt(key, locale);
      assert.ok(value.endsWith(endings[index]));
      assert.equal(identifyBuiltinPrompt(value), key);
      assert.equal(identifyBuiltinPrompt(promptTemplates[key] + `\nWrite in ${locale}.`), key);
      values.add(value);
    }
    assert.equal(values.size, 5);
  }
  assert.equal(
    identifyBuiltinPrompt(builtinPrompt("summary", "zh-TW") + "\nMy extra requirement."),
    undefined,
  );
});
