import assert from "node:assert/strict";
import test from "node:test";
import { LearningDocumentSchema } from "./schema";
import { compactStudyExport, learningDocumentToMarkdown } from "./export";

const document = LearningDocumentSchema.parse({
  schemaVersion: 5,
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: { platform: "youtube", title: "Context * lesson" },
  profile: {
    targetLanguage: "en",
    instructionLanguage: "zh-TW",
    level: "B1",
    sceneCount: 2,
    contextualExampleCount: 1,
  },
  generation: { provider: "openai", modelId: "" },
  cues: [
    { id: "unused", startMs: 0, endMs: 500, originalText: "Unused" },
    { id: "q", startMs: 1000, endMs: 2000, originalText: "What about dinner?" },
    { id: "a", startMs: 2100, endMs: 3300, originalText: "I haven't decided yet." },
  ],
  sections: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      title: "Dinner plans",
      context: "A real exchange about an undecided plan.",
      cueIds: ["q", "a"],
      startMs: 1000,
      endMs: 3300,
      translations: [
        { cueId: "q", text: "晚餐呢？" },
        { cueId: "a", text: "我還沒決定。" },
      ],
      focusItems: [
        {
          expression: "I haven't decided yet.",
          sourceCueIds: ["a"],
          meaning: "我還沒決定。",
          contextExplanation: "The question shows what is still undecided.",
          contextCueIds: ["q"],
          wordNotes: [{ surface: "yet", meaning: "尚未", explanation: "Up to now." }],
          examples: [
            {
              situation: "A friend asks about a trip.",
              dialogue: [
                { text: "Have you decided?", translation: "你決定了嗎？" },
                { text: "I haven't decided yet.", translation: "我還沒決定。" },
              ],
            },
          ],
        },
      ],
    },
  ],
});

test("V5 Markdown keeps source evidence, word notes and labeled AI examples", () => {
  const md = learningDocumentToMarkdown(document);
  assert.ok(md.includes("Context \\* lesson"));
  assert.match(md, /> \[1s\] What about dinner\?/);
  assert.match(md, /The question shows what is still undecided/);
  assert.match(md, /\*\*Word notes\*\*/);
  assert.match(md, /\*\*AI-created contextual examples\*\*/);
});

test("compact V5 export retains contextual content and selected source cues", () => {
  const compact = compactStudyExport(document);
  assert.deepEqual(
    compact.cues.map(cue => cue.id),
    ["q", "a"],
  );
  assert.equal(compact.sections[0].focusItems[0].examples.length, 1);
});

test("V5 playback calibration round trips without editing source timestamps", () => {
  const sceneId = document.sections[0].id;
  const saved = LearningDocumentSchema.parse({
    ...document,
    playbackOverrides: { a: { startMs: 2300, endMs: 3500 } },
    scenePlaybackOverrides: { [sceneId]: { startMs: 800, endMs: 3900 } },
  });
  const imported = LearningDocumentSchema.parse(
    JSON.parse(JSON.stringify(compactStudyExport(saved))),
  );
  assert.deepEqual(imported.playbackOverrides?.a, { startMs: 2300, endMs: 3500 });
  assert.deepEqual(imported.scenePlaybackOverrides?.[sceneId], { startMs: 800, endMs: 3900 });
  assert.equal(imported.cues.find(cue => cue.id === "a")?.startMs, 2100);
  assert.match(learningDocumentToMarkdown(saved), /User-calibrated scene playback/);
  assert.equal(
    LearningDocumentSchema.safeParse({
      ...document,
      playbackOverrides: { a: { startMs: 3500, endMs: 2300 } },
    }).success,
    false,
  );
  assert.equal(LearningDocumentSchema.safeParse({ ...document, schemaVersion: 3 }).success, false);
});
