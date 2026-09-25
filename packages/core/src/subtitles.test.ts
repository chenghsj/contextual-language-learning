import assert from "node:assert/strict";
import test from "node:test";
import { chunkCues, formatTime, parsePlainText, parseSubtitles, youtubeTimeLink } from "./subtitles";

test("SRT and VTT preserve timestamps and original text", () => {
  const cues = parseSubtitles("WEBVTT\n\n00:00:01.250 --> 00:00:03.500 align:start\n<v A>Hello</v> there\n\n2\n00:00:04,000 --> 00:00:05,000\nGoodbye");
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startMs, 1250);
  assert.equal(cues[0].originalText, "Hello there");
  assert.equal(cues[1].endMs, 5000);
});

test("invalid and empty cues are skipped", () => {
  assert.equal(parseSubtitles("1\n00:00:05,000 --> 00:00:01,000\nNo\n\n2\n00:00:01,000 --> 00:00:02,000\nYes").length, 1);
});

test("text import and chunking keep all cues in order", () => {
  const cues = parsePlainText("First paragraph.\n\nSecond paragraph.\n\nThird paragraph.");
  assert.equal(cues.length, 3);
  const chunks = chunkCues(cues, 18);
  assert.deepEqual(chunks.flat().map(c => c.id), cues.map(c => c.id));
});

test("YouTube timestamps use an allowlisted video host", () => {
  assert.equal(youtubeTimeLink("https://youtu.be/dQw4w9WgXcQ", 125000), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s");
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
