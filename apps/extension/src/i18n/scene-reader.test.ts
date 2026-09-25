import assert from "node:assert/strict";
import test from "node:test";
import { sceneReaderMessages } from "./scene-reader";
import { messages, type UiLocale } from "./messages";

test("every locale has every scene study, player and hint label", () => {
  const enKeys = Object.keys(sceneReaderMessages.en).sort();
  for (const locale of Object.keys(messages) as UiLocale[]) {
    assert.deepEqual(Object.keys(sceneReaderMessages[locale]).sort(), enKeys);
    for (const [key, value] of Object.entries(sceneReaderMessages[locale])) {
      assert.ok(value.trim(), locale + ":" + key);
    }
  }
});
