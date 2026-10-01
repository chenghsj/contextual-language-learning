import assert from "node:assert/strict";
import test from "node:test";
import {
  captionCacheKey,
  isCurrentCaption,
  subtitleLanguageMatches,
  videoSourceKey,
  type CaptionProvenance,
} from "./caption-provenance";

const youtube = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const netflix = "https://www.netflix.com/watch/12345678";

test("caption identity distinguishes exact video ID and language without embedding signed URLs", () => {
  assert.equal(videoSourceKey(youtube), "youtube:dQw4w9WgXcQ");
  assert.equal(videoSourceKey(netflix), "netflix:12345678");
  assert.notEqual(captionCacheKey(youtube, "ja"), captionCacheKey(youtube, "en"));
  assert.notEqual(captionCacheKey(youtube, "en"), captionCacheKey(netflix, "en"));
  assert.equal(videoSourceKey("https://example.com/watch/12345678"), null);
});

test("accepts same-language regional caption tracks and rejects other languages", () => {
  assert.equal(subtitleLanguageMatches("en", "en-US"), true);
  assert.equal(subtitleLanguageMatches("ja", "ja_JP"), true);
  assert.equal(subtitleLanguageMatches("ja", "en"), false);
  assert.equal(subtitleLanguageMatches("en", "english"), false);
  for (const [language, regional] of [
    ["id", "id-ID"],
    ["th", "th-TH"],
    ["ms", "ms-MY"],
    ["vi", "vi-VN"],
  ] as const) {
    assert.equal(subtitleLanguageMatches(language, regional), true);
    assert.equal(subtitleLanguageMatches(language, "en-US"), false);
  }
});

test("generation requires a matching requested and actual caption language and video", () => {
  const ready: CaptionProvenance = {
    sourceKey: videoSourceKey(youtube),
    language: "ja",
    actualLanguage: "ja-JP",
    origin: "video",
  };
  assert.equal(isCurrentCaption(ready, "ja", youtube), true);
  assert.equal(isCurrentCaption(ready, "en", youtube), false);
  assert.equal(isCurrentCaption(ready, "ja", netflix), false);
  assert.equal(isCurrentCaption({ ...ready, actualLanguage: "en" }, "ja", youtube), false);
  assert.equal(isCurrentCaption({ ...ready, actualLanguage: undefined }, "ja", youtube), false);
  assert.equal(isCurrentCaption({ ...ready, sourceKey: null }, "ja", undefined), false);
  assert.equal(
    isCurrentCaption({ sourceKey: null, origin: "manual", language: "ja" }, "ja", ""),
    true,
  );
  assert.equal(
    isCurrentCaption({ sourceKey: null, origin: "manual", language: "ja" }, "en", ""),
    false,
  );
});
