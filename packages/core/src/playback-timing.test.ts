import test from "node:test";
import assert from "node:assert/strict";
import { withSentenceTiming } from "./playback-timing";
import { pointsFixture } from "../test/learning-points-fixture";
const document = pointsFixture().document;
document.cues = [
  { id: "cue-1", startMs: 1000, endMs: 2900, originalText: "What about dinner?" },
  { id: "cue-2", startMs: 3100, endMs: 5500, originalText: "I haven't decided yet." },
  { id: "cue-3", startMs: 5600, endMs: 7500, originalText: "Let's decide tomorrow." },
];
document.sections[0].cueIds = ["cue-1", "cue-2", "cue-3"];
document.sections[0].startMs = 1000;
document.sections[0].endMs = 7500;
test("sentence edits expand all containing scenes without replacing source times", () => {
  const original = structuredClone(document);
  const scene = document.sections[0];
  const expanded = withSentenceTiming(document, "cue-1", { startMs: 500, endMs: 9000 });
  assert.deepEqual(expanded.scenePlaybackOverrides?.[scene.id], { startMs: 500, endMs: 9000 });
  assert.deepEqual(document, original);
  assert.deepEqual(expanded.cues, document.cues);
  const shortened = withSentenceTiming(expanded, "cue-1", { startMs: 2000, endMs: 2800 });
  assert.deepEqual(shortened.scenePlaybackOverrides, expanded.scenePlaybackOverrides);
  const reset = withSentenceTiming(shortened, "cue-1", null);
  assert.equal(reset.playbackOverrides?.["cue-1"], undefined);
  assert.deepEqual(reset.scenePlaybackOverrides, expanded.scenePlaybackOverrides);
});

test("overlapping sentences remain independent and expand scene at both ends", () => {
  const doc = withSentenceTiming(document, "cue-1", { startMs: 0, endMs: 4000 });
  const next = withSentenceTiming(doc, "cue-2", { startMs: 3000, endMs: 10000 });
  assert.deepEqual(next.playbackOverrides?.["cue-1"], { startMs: 0, endMs: 4000 });
  assert.deepEqual(next.scenePlaybackOverrides?.[document.sections[0].id], {
    startMs: 0,
    endMs: 10000,
  });
});
