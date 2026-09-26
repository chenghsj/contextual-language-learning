import assert from "node:assert/strict";
import test from "node:test";
import type { SubtitleCue } from "@immersive/core";
import { playingCueAt } from "./cue-follow";

const cues = new Map<string, SubtitleCue>([
  ["a", { id: "a", startMs: 1_000, endMs: 3_000, originalText: "First" }],
  ["b", { id: "b", startMs: 2_000, endMs: 4_000, originalText: "Second" }],
  ["c", { id: "c", startMs: null, endMs: null, originalText: "Unknown time" }],
  ["d", { id: "d", startMs: 5_000, endMs: 5_000, originalText: "Zero duration" }],
]);
test("highlight follows actual video time and honors cue boundaries while scrubbing", () => {
  assert.equal(playingCueAt(["a", "b"], cues, 999), null);
  assert.equal(playingCueAt(["a", "b"], cues, 1000), "a");
  assert.equal(playingCueAt(["a", "b"], cues, 2500), "b", "latest overlapping line wins");
  assert.equal(playingCueAt(["a", "b"], cues, 3999), "b");
  assert.equal(playingCueAt(["a", "b"], cues, 4000), null);
  assert.equal(playingCueAt(["a", "b"], cues, 1500), "a", "seek backward updates the line");
  assert.equal(playingCueAt(["a"], cues, 2500), "a", "only current scene IDs are considered");
  assert.equal(playingCueAt(["a", "b"], cues, null), null);
});
test("missing or corrupt timestamps never create a misleading active highlight", () => {
  assert.equal(playingCueAt(["c", "d"], cues, 5000), null);
  assert.equal(playingCueAt(["a", "b"], cues, NaN), null);
  assert.equal(playingCueAt(["a", "b"], cues, Infinity), null);
});
