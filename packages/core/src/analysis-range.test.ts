import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalysisRangeSchema,
  selectAnalysisCues,
  parseRangeTime,
  formatRangeTime,
} from "./analysis-range";
const cues = [
  { id: "original-a", startMs: 0, endMs: 1000, originalText: "A" },
  { id: "original-b", startMs: 1000, endMs: 2000, originalText: "B" },
  { id: "original-c", startMs: 2500, endMs: 3000, originalText: "C" },
];
test("range uses half-open overlap and preserves canonical cue ids and times", () => {
  assert.deepEqual(selectAnalysisCues(cues, { mode: "custom", startMs: 1000, endMs: 2500 }), [
    cues[1],
  ]);
  assert.deepEqual(
    selectAnalysisCues(cues, { mode: "custom", startMs: 999, endMs: 1001 }),
    cues.slice(0, 2),
  );
  assert.equal(selectAnalysisCues(cues, { mode: "custom", startMs: 2100, endMs: 2400 }).length, 0);
  assert.deepEqual(
    cues.map(c => c.id),
    ["original-a", "original-b", "original-c"],
  );
});
test("invalid times and out-of-duration ranges cannot become a request", () => {
  for (const [startMs, endMs] of [
    [1000, 1000],
    [2000, 1000],
    [-1, 1000],
    [0, 4000],
    [NaN, 1000],
  ]) {
    assert.equal(
      AnalysisRangeSchema.safeParse({
        mode: "custom",
        startMs,
        endMs,
        durationMs: 3000,
        durationSource: "subtitles",
      }).success,
      false,
    );
  }
  assert.equal(parseRangeTime("00:60:00"), NaN);
  assert.equal(parseRangeTime("01:02:03.045"), 3723045);
  assert.equal(formatRangeTime(3723000), "01:02:03");
});
test("partially timed input only allows full content", () => {
  const untimed = [{ ...cues[0], startMs: null }];
  assert.equal(selectAnalysisCues(untimed, { mode: "full", startMs: 0, endMs: 3000 }), untimed);
  assert.throws(
    () => selectAnalysisCues(untimed, { mode: "first", startMs: 0, endMs: 1000 }),
    /Untimed/,
  );
});
