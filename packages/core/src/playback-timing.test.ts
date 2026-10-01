import test from "node:test";
import assert from "node:assert/strict";
import { withSentenceTiming } from "./playback-timing";
import type { LearningDocument } from "./schema";
const document: LearningDocument = {
  schemaVersion: 4, id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: { platform: "youtube", title: "An original video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
    sceneCount: 2, contextualExampleCount: 2 },
  generation: { provider: "claude", modelId: "" },
  cues: [
    { id: "cue-1", startMs: 1000, endMs: 2900, originalText: "What about dinner?" },
    { id: "cue-2", startMs: 3100, endMs: 5500, originalText: "I haven't decided yet." },
    { id: "cue-3", startMs: 5600, endMs: 7500, originalText: "Let's decide tomorrow." },
  ],
  sections: [{
    id: "00000000-0000-4000-8000-000000000002",
    title: "Dinner plans", context: "Someone is asked about dinner and has not decided.",
    cueIds: ["cue-1", "cue-2", "cue-3"],
    startMs: 1000, endMs: 7500,
    translations: [
      { cueId: "cue-1", text: "晚餐怎麼辦？" },
      { cueId: "cue-2", text: "還沒決定。" },
      { cueId: "cue-3", text: "明天再決定。" },
    ],
    focusItems: [{
      expression: "I haven't decided yet.", sourceCueIds: ["cue-2"],
      meaning: "我還沒決定。",
      contextExplanation: "The question about dinner and the tomorrow reply indicate no decision has been made.",
      contextCueIds: ["cue-1", "cue-3"],
      wordNotes: [{ surface: "yet", meaning: "尚未", explanation: "Not decided so far." }],
      examples: [
        { situation: "A friend asks about a trip.", dialogue: [
          { text: "Have you decided on a trip?", translation: "決定旅行了嗎？" },
          { text: "I haven't decided yet.", translation: "我還沒決定。" },
        ] },
        { situation: "A colleague asks about lunch.", dialogue: [
          { text: "What about lunch?", translation: "午餐呢？" },
          { text: "I haven't decided yet.", translation: "我還沒決定。" },
        ] },
      ],
    }],
  }],
};


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
  assert.deepEqual(next.scenePlaybackOverrides?.[document.sections[0].id], { startMs: 0, endMs: 10000 });
});
