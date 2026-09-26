import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { messages, translate, type UiLocale } from "./messages";

test("saved legacy V1/V2 readers disclose their version in all five locales", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(source, /document && document\.schemaVersion !== 3 && <Card/);
  assert.match(source, /t\("legacyReaderNotice", \{ version: document\.schemaVersion \}\)/);
  assert.match(source, /onClick=\{\(\) => setPage\("create"\)\}/);
  assert.match(source, /document\.schemaVersion === 3 \? <ContextualSceneReader/);
  assert.match(source, /document\.schemaVersion === 2 \? <SceneReader/);
  for (const locale of Object.keys(messages) as UiLocale[]) {
    assert.ok(translate(locale, "legacyReaderNotice", { version: 2 }).includes("2"), locale);
    assert.ok(translate(locale, "legacyReaderNotice", { version: 1 }).includes("1"), locale);
    assert.ok(translate(locale, "createV3FromLegacy").trim().length > 0, locale);
  }
});
