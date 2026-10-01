import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMPTY_OPTION_VALUE, SelectField, decodeSelectValue, encodeSelectValue,
} from "../components/ui/select";
import { SearchableSelectField } from "../components/searchable-select-field";
import { filterSearchableOptions } from "../lib/searchable-options";
import { learningLanguageOptions } from "./preferences";

test("standard selectors use Radix and the learning-language selector uses searchable choices", async () => {
  for (const path of ["../App.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<NativeSelect\b|<select\b|<option\b/);
    assert.match(source, /<SelectField\b/);
  }
  const component = await readFile(new URL("../components/ui/select.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /export function NativeSelect|<select\b/);
  assert.match(component, /SelectPrimitive\.Portal/);
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /<SearchableSelectField id="learning-target"/);
  assert.doesNotMatch(app, /FEATURED_LEARNING_LANGUAGES|LEARNING_LANGUAGE_GROUP_LABELS/);
});

test("Radix empty-option sentinel is reversed before saving CLI and account IDs", () => {
  assert.equal(encodeSelectValue(""), EMPTY_OPTION_VALUE);
  assert.equal(decodeSelectValue(EMPTY_OPTION_VALUE), "");
  for (const value of ["codex", "agy", "__custom__", "__legacy__", "0", "1"]) {
    assert.equal(decodeSelectValue(encodeSelectValue(value)), value);
  }
  assert.throws(() => encodeSelectValue(EMPTY_OPTION_VALUE), /Reserved/);
});

test("all migrated SelectField controls render a labelled combobox instead of native dropdown UI", () => {
  const html = renderToStaticMarkup(createElement(SelectField, {
    id: "model-select",
    ariaLabel: "Model",
    value: "",
    onValueChange: () => undefined,
    options: [{ value: "", label: "CLI default" }, { value: "test-id", label: "Test model" }],
  }));
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="Model"/);
  assert.match(html, /id="model-select"/);
  assert.match(html, /CLI default/);
});

test("learning-language search finds names across locales and language codes", () => {
  const options = learningLanguageOptions("zh-TW");
  assert.equal(filterSearchableOptions(options, "日本語")[0]?.value, "ja");
  assert.equal(filterSearchableOptions(options, "spanish")[0]?.value, "es");
  assert.equal(filterSearchableOptions(options, " fr ")[0]?.value, "fr");
  assert.deepEqual(filterSearchableOptions(options, ""), options);
  assert.deepEqual(filterSearchableOptions(options, "unknown language"), []);
});

test("searchable learning-language picker shows the saved selection and localized search", () => {
  const html = renderToStaticMarkup(createElement(SearchableSelectField, {
    id: "learning-target", ariaLabel: "學習語言", value: "ja",
    onValueChange: () => undefined, options: learningLanguageOptions("zh-TW"),
    copy: { search: "搜尋語言", empty: "找不到符合的語言" },
  }));
  assert.match(html, /id="learning-target"/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /日語/);
  assert.doesNotMatch(html, /常用語言|更多語言/);
  assert.doesNotMatch(html, /<dialog|aria-modal|backdrop:/);
});
