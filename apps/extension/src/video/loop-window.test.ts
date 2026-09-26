import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustLoopBoundary, formatLoopTimestamp, isLoopWindow, readLoopWindows,
  MAX_LOOP_DURATION_MS, MIN_LOOP_DURATION_MS,
} from "./loop-window";

test("A/B boundaries accept calibrated time but never a reversed or excessively long loop", () => {
  const source = { startMs: 83_500, endMs: 85_600 };
  assert.equal(MIN_LOOP_DURATION_MS, 250);
  assert.equal(MAX_LOOP_DURATION_MS, 600_000);
  assert.deepEqual(adjustLoopBoundary(source, "start", 83_000), { startMs: 83_000, endMs: 85_600 });
  assert.deepEqual(adjustLoopBoundary(source, "end", 87_049), { startMs: 83_500, endMs: 87_000 });
  for (const time of [85_500, 90_000, -1, Number.NaN]) {
    assert.equal(adjustLoopBoundary(source, "start", time), null);
  }
  assert.equal(adjustLoopBoundary(source, "end", 83_500), null);
  assert.equal(adjustLoopBoundary(source, "end", 999_999), null);
  assert.deepEqual(source, { startMs: 83_500, endMs: 85_600 });
});

test("saved ranges are strictly validated per cue and ignore stale or malformed data", () => {
  assert.equal(isLoopWindow({ startMs: 1_000, endMs: 1_500 }), true);
  assert.equal(isLoopWindow({ startMs: 1_000, endMs: 1_050 }), false);
  assert.equal(isLoopWindow({ startMs: -1, endMs: 1_000 }), false);
  assert.equal(isLoopWindow({ startMs: 1_000, endMs: Infinity }), false);
  const saved = readLoopWindows({
    "cue-1": { startMs: 1_000, endMs: 2_000 },
    "cue-2": { startMs: 5_000, endMs: 4_000 },
    "old-cue": { startMs: 1_000, endMs: 2_000 },
  }, ["cue-1", "cue-2"]);
  assert.deepEqual(saved, { "cue-1": { startMs: 1_000, endMs: 2_000 } });
  assert.deepEqual(readLoopWindows([], ["cue-1"]), {});
});

test("calibrated boundaries are readable to a tenth of a second", () => {
  assert.equal(formatLoopTimestamp(0), "00:00.0");
  assert.equal(formatLoopTimestamp(83_550), "01:23.6");
  assert.equal(formatLoopTimestamp(272_000), "04:32.0");
});
