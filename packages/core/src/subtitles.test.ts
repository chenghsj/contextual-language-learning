import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkCues,
  formatTime,
  parsePlainText,
  parseSubtitles,
  youtubeTimeLink,
} from "./subtitles";

test("SRT and VTT preserve timestamps and original text", () => {
  const cues = parseSubtitles(
    "WEBVTT\n\n00:00:01.250 --> 00:00:03.500 align:start\n<v A>Hello</v> there\n\n2\n00:00:04,000 --> 00:00:05,000\nGoodbye",
  );
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1250);
  assert.equal(cues[0].originalText, "Hello there");
  assert.equal(cues[1].endMs, 5000);
});

test("invalid and empty cues are skipped", () => {
  assert.equal(
    parseSubtitles("1\n00:00:05,000 --> 00:00:01,000\nNo\n\n2\n00:00:01,000 --> 00:00:02,000\nYes")
      .length,
    1,
  );
});

test("text import and chunking keep all cues in order", () => {
  const cues = parsePlainText("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  assert.equal(cues.length, 3);
  const chunks = chunkCues(cues, 18);
  assert.deepEqual(
    chunks.flat().map(c => c.id),
    cues.map(c => c.id),
  );
});

test("YouTube timestamps use an allowlisted video host", () => {
  assert.equal(
    youtubeTimeLink("https://youtu.be/dQw4w9WgXcQ", 125000),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s",
  );
  assert.equal(youtubeTimeLink("https://evil.example/watch?v=dQw4w9WgXcQ", 125000), null);
  assert.equal(formatTime(125000), "02:05");
});

test("long plain-text input is split without dropping words", () => {
  const input = "word ".repeat(800).trim();
  const cues = parsePlainText(input);
  assert.ok(cues.length > 1);
  assert.equal(cues.map(cue => cue.originalText).join(" "), input);
  assert.ok(cues.every(cue => cue.originalText.length <= 1500));
});

test("ruby readings stay outside source text and retain their source ranges", () => {
  const [cue] = parseSubtitles(
    "WEBVTT\n\n00:00:10.000 --> 00:00:12.000\n（<ruby>赤福<rt>あかふく</rt></ruby>） ヒカルの漫画\n<ruby.under>面白<rt>おもしれ</rt></ruby>え～",
  );
  assert.equal(cue.originalText, "（赤福） ヒカルの漫画 面白え～");
  assert.deepEqual(cue.ruby, [
    { start: 1, end: 3, reading: "あかふく", position: "over" },
    { start: 12, end: 14, reading: "おもしれ", position: "under" },
  ]);
});

test("ruby supports styled HTML, fallback parentheses, entities and repeated base text", () => {
  const [cue] = parseSubtitles(
    '1\n00:00:01,000 --> 00:00:02,000\n  &lt;例&gt; <ruby style="ruby-position: under"><span>面白</span><rp>（</rp><rt><span>おもしれ</span></rt><rp>）</rp></ruby>え～ <ruby>面白<rt>おもしろ</rt></ruby>い &amp; &#x1F600;',
  );
  assert.equal(cue.originalText, "<例> 面白え～ 面白い & 😀");
  assert.deepEqual(cue.ruby, [
    { start: 4, end: 6, reading: "おもしれ", position: "under" },
    { start: 9, end: 11, reading: "おもしろ", position: "over" },
  ]);
});

test("multi-pair VTT ruby and unclosed annotations do not contaminate source text", () => {
  const [cue] = parseSubtitles(
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<ruby>赤<rt>あか</rt>福<rt>ふく</rt></ruby> <ruby>面白<rt>おもしれ",
  );
  assert.equal(cue.originalText, "赤福 面白");
  assert.deepEqual(cue.ruby?.slice(0, 2), [
    { start: 0, end: 1, reading: "あか", position: "over" },
    { start: 1, end: 2, reading: "ふく", position: "over" },
  ]);
});
