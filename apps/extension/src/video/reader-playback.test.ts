import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustedStart,
  calibratedRange,
  effectiveCueWindow,
  playbackCueMap,
  cuePlaybackWindow,
  repeatCount,
  scenePlaybackWindow,
} from "./reader-playback";

const youtubeCues = [
  { id: "a", startMs: 1000, endMs: 2000, originalText: "First sentence." },
  { id: "blank", startMs: 2200, endMs: 2300, originalText: "\n\u200b" },
  { id: "duplicate", startMs: 2500, endMs: 2700, originalText: "First sentence." },
  { id: "b", startMs: 7000, endMs: 8000, originalText: "Second sentence." },
  { id: "c", startMs: 9000, endMs: 10000, originalText: "Third sentence." },
];

test("YouTube derives ends from the next distinct nonempty source start without mutating cues", () => {
  const source = structuredClone(youtubeCues);
  const cues = playbackCueMap(youtubeCues, "youtube", {});
  assert.deepEqual(effectiveCueWindow(cues.get("a"), {}), { startMs: 1000, endMs: 7000 });
  assert.deepEqual(effectiveCueWindow(cues.get("b"), {}), { startMs: 7000, endMs: 9000 });
  assert.deepEqual(effectiveCueWindow(cues.get("c"), {}), { startMs: 9000, endMs: 10000 });
  assert.deepEqual(youtubeCues, source);
  assert.deepEqual(cuePlaybackWindow(["a", "b"], cues), { startMs: 1000, endMs: 9000 });
  assert.deepEqual(effectiveCueWindow(playbackCueMap(youtubeCues, "netflix", {}).get("a"), {}), {
    startMs: 1000,
    endMs: 2000,
  });
});

test("manual calibration wins and reset derives from original next starts", () => {
  const calibrated = playbackCueMap(youtubeCues, "youtube", {
    a: { startMs: 1200, endMs: 6500 },
    b: { startMs: 7500, endMs: 9500 },
  });
  assert.deepEqual(effectiveCueWindow(calibrated.get("a"), {}), { startMs: 1200, endMs: 6500 });
  const reset = playbackCueMap(youtubeCues, "youtube", {
    b: { startMs: 7500, endMs: 9500 },
  });
  assert.deepEqual(effectiveCueWindow(reset.get("a"), {}), { startMs: 1000, endMs: 7000 });
  assert.deepEqual(effectiveCueWindow(reset.get("b"), {}), { startMs: 7500, endMs: 9500 });
});

test("YouTube uses chronological distinct starts and can repair an invalid source end", () => {
  const cues = playbackCueMap(
    [
      { id: "later", startMs: 3000, endMs: 6000, originalText: "Next" },
      { id: "first", startMs: 1000, endMs: 500, originalText: "First" },
      { id: "same-start", startMs: 1000, endMs: 2000, originalText: "Overlay" },
    ],
    "youtube",
    {},
  );
  assert.deepEqual(effectiveCueWindow(cues.get("first"), {}), { startMs: 1000, endMs: 3000 });
  assert.deepEqual(effectiveCueWindow(cues.get("same-start"), {}), { startMs: 1000, endMs: 3000 });
  assert.deepEqual(effectiveCueWindow(cues.get("later"), {}), { startMs: 3000, endMs: 6000 });
});

test("reader playback derives windows without changing canonical cue times", () => {
  const cue = { id: "a", startMs: 2_000, endMs: 3_000, originalText: "Hello" };
  const original = { ...cue };
  const window = effectiveCueWindow(cue, {});
  assert.deepEqual(window, { startMs: 2000, endMs: 3000 });
  assert.deepEqual(cue, original);
  assert.deepEqual(effectiveCueWindow(cue, { a: { startMs: 2_200, endMs: 2_800 } }), {
    startMs: 2_200,
    endMs: 2_800,
  });
  assert.equal(effectiveCueWindow({ ...cue, startMs: null }, {}), null);
  assert.deepEqual(scenePlaybackWindow(2_000, 4_000), { startMs: 2000, endMs: 4000 });
  assert.equal(scenePlaybackWindow(null, 4_000), null);
});

test("calibration rejects inverted or too-short ranges and repeat values stay bounded", () => {
  assert.deepEqual(calibratedRange(1_000, 2_000), { startMs: 1_000, endMs: 2_000 });
  assert.equal(calibratedRange(2_000, 1_000), null);
  assert.equal(calibratedRange(1_000, 1_100), null);
  assert.deepEqual(adjustedStart({ startMs: 500, endMs: 2_000 }, -1_000), {
    startMs: 0,
    endMs: 2_000,
  });
  assert.equal(adjustedStart({ startMs: 500, endMs: 2_000 }, 1_500), null);
  assert.equal(repeatCount("3"), 3);
  assert.equal(repeatCount("infinite"), "infinite");
});
