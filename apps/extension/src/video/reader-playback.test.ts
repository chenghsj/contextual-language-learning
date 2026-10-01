import assert from "node:assert/strict";
import test from "node:test";
import { adjustedStart, calibratedRange, effectiveCueWindow, repeatCount, scenePlaybackWindow } from "./reader-playback";

test("reader playback derives windows without changing canonical cue times", () => {
  const cue = { id: "a", startMs: 2_000, endMs: 3_000, originalText: "Hello" };
  const original = { ...cue };
  const window = effectiveCueWindow(cue, {});
  assert.deepEqual(window, { startMs: 2000, endMs: 3000 });
  assert.deepEqual(cue, original);
  assert.deepEqual(effectiveCueWindow(cue, { a: { startMs: 2_200, endMs: 2_800 } }),
    { startMs: 2_200, endMs: 2_800 });
  assert.equal(effectiveCueWindow({ ...cue, startMs: null }, {}), null);
  assert.deepEqual(scenePlaybackWindow(2_000, 4_000), { startMs: 2000, endMs: 4000 });
  assert.equal(scenePlaybackWindow(null, 4_000), null);
});

test("calibration rejects inverted or too-short ranges and repeat values stay bounded", () => {
  assert.deepEqual(calibratedRange(1_000, 2_000), { startMs: 1_000, endMs: 2_000 });
  assert.equal(calibratedRange(2_000, 1_000), null);
  assert.equal(calibratedRange(1_000, 1_100), null);
  assert.deepEqual(adjustedStart({ startMs: 500, endMs: 2_000 }, -1_000),
    { startMs: 0, endMs: 2_000 });
  assert.equal(adjustedStart({ startMs: 500, endMs: 2_000 }, 1_500), null);
  assert.equal(repeatCount("3"), 3);
  assert.equal(repeatCount("infinite"), "infinite");
});
