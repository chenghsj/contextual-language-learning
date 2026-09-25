import assert from "node:assert/strict";
import test from "node:test";
import { videoMetadataMessages } from "./video-metadata";
import { messages } from "./messages";

test("every UI locale has actionable metadata recovery and conflict messages", () => {
  const required = [
    "get", "refresh", "busy", "success", "partial", "unavailable",
    "invalidSource", "mismatch", "confirmUnlinked", "changed",
  ] as const;
  for (const locale of Object.keys(messages) as Array<keyof typeof messages>) {
    for (const key of required) {
      assert.ok(videoMetadataMessages[locale][key].trim(),
        locale + " is missing video metadata message " + key);
    }
  }
});
