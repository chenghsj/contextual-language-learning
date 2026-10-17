import assert from "node:assert/strict";
import test from "node:test";
import { SubtitleCueSchema, GenerationRequestSchema } from "./schema";
import { parseSubtitles } from "./subtitles";
import { serializeSubtitleMarkup, subtitlePronunciationSegments } from "./subtitle-ruby";
import { pronunciationSlice } from "./sentence-analysis";
import { pointsFixture } from "../test/learning-points-fixture";

function fixture() {
  return parseSubtitles(
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nヒカルの漫画 <ruby.under>面白<rt>おもしれ</rt></ruby>え～",
  )[0];
}
test("source ruby survives request schemas and cue markup round trips", () => {
  const cue = fixture(),
    f = pointsFixture();
  f.request.cues = [cue];
  const request = GenerationRequestSchema.parse(f.request);
  assert.deepEqual(request.cues[0].ruby, cue.ruby);
  const [restored] = parseSubtitles(
    `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${serializeSubtitleMarkup(request.cues[0])}`,
  );
  assert.deepEqual(restored, cue);
  assert.equal(
    SubtitleCueSchema.safeParse({
      ...cue,
      ruby: [{ start: 0, end: 100, reading: "あ", position: "over" }],
    }).success,
    false,
  );
  assert.equal(
    SubtitleCueSchema.safeParse({ ...cue, ruby: [cue.ruby![0], cue.ruby![0]] }).success,
    false,
  );
});

test("source readings override model guesses and work without generated pronunciations", () => {
  const cue = fixture();
  const source = subtitlePronunciationSegments(cue);
  assert.deepEqual(source, [
    { text: "ヒカルの漫画 " },
    { text: "面白", reading: "おもしれ", rubyPosition: "under" },
    { text: "え～" },
  ]);
  const merged = subtitlePronunciationSegments(cue, [
    { text: "ヒカルの漫画 ", reading: "ひかるのまんが" },
    { text: "面白え", reading: "おもしろえ" },
    { text: "～" },
  ]);
  assert.equal(merged?.map(item => item.text).join(""), cue.originalText);
  assert.equal(merged?.[0].reading, "ひかるのまんが");
  assert.equal(merged?.[1].reading, "おもしれ");
  assert.equal(merged?.[2].reading, undefined);
  assert.deepEqual(pronunciationSlice(source, cue.originalText, 7, 9), [source![1]]);
  assert.equal(pronunciationSlice(source, cue.originalText, 7, 8)?.[0].reading, undefined);
});
