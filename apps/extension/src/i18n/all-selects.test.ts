import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EMPTY_OPTION_VALUE, SelectField, decodeSelectValue, encodeSelectValue,
} from "../components/ui/select";

test("every application and scene reader option uses Radix SelectField", async () => {
  for (const path of ["../App.tsx", "../components/scene-reader.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<NativeSelect\b|<select\b|<option\b/);
    assert.match(source, /<SelectField\b/);
  }
  const component = await readFile(new URL("../components/ui/select.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /export function NativeSelect|<select\b/);
  assert.match(component, /SelectPrimitive\.Portal/);
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
