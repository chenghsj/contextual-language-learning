import assert from "node:assert/strict";
import test from "node:test";
import { playbackTimingMessages } from "./playback-timing";
import { messages, type UiLocale } from "./messages";

test("every locale has the playback timing labels", () => {
  const enKeys = Object.keys(playbackTimingMessages.en).sort();
  for (const locale of Object.keys(messages) as UiLocale[]) {
    assert.deepEqual(Object.keys(playbackTimingMessages[locale]).sort(), enKeys);
    for (const [key, value] of Object.entries(playbackTimingMessages[locale])) {
      assert.ok(value.trim(), locale + ":" + key);
    }
  }
});
