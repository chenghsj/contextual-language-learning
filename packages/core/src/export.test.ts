import assert from "node:assert/strict";
import test from "node:test";
import { LearningDocumentSchema } from "./schema";
import { compactStudyExport, learningDocumentToMarkdown } from "./export";

const v3 = LearningDocumentSchema.parse({
  schemaVersion: 3,
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: { platform: "youtube", title: "Context * lesson" },
  profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
    mode: "adaptive", maxNewVocabulary: 2, exerciseCount: 0, sceneCount: 1, contextualExampleCount: 1 },
  generation: { provider: "claude", modelId: "" },
  cues: [
    { id: "unused", startMs: 0, endMs: 500, originalText: "Unused" },
    { id: "q", startMs: 1000, endMs: 2000, originalText: "What about dinner?" },
    { id: "a", startMs: 2100, endMs: 3300, originalText: "I haven't decided yet." },
  ],
  sections: [{
    id: "00000000-0000-4000-8000-000000000002",
    title: "Dinner plans", context: "A real exchange about an undecided plan.",
    learningGoal: "Understand an undecided plan.",
    cueIds: ["q", "a"], focusCueIds: ["a"], startMs: 1000, endMs: 3300,
    translations: [{ cueId: "q", text: "晚餐呢？" }, { cueId: "a", text: "我還沒決定。" }],
    vocabulary: [], insights: [], exercises: [],
    focusItems: [{
      expression: "I haven't decided yet.", sourceCueIds: ["a"],
      meaning: "我還沒決定。", contextExplanation: "The question shows what is still undecided.",
      contextCueIds: ["q"], wordNotes: [{ surface: "yet", meaning: "尚未", explanation: "Up to now." }],
      examples: [{ situation: "A friend asks about a trip.", dialogue: [
        { text: "Have you decided?", translation: "你決定了嗎？" },
        { text: "I haven't decided yet.", translation: "我還沒決定。" },
      ] }],
    }],
  }],
});

test("V3 Markdown includes original context, word notes and clearly labeled AI examples", () => {
  const md = learningDocumentToMarkdown(v3);
  assert.match(md, /Context \\* lesson/);
  assert.match(md, /> \[1s\] What about dinner\?/);
  assert.match(md, /### Focus expressions/);
  assert.match(md, /The question shows what is still undecided/);
  assert.match(md, /\*\*Word notes\*\*/);
  assert.match(md, /\*\*AI-created contextual examples\*\*/);
  assert.match(md, /A friend asks about a trip/);
});

test("compact V3 JSON keeps focus content but removes transcript cues outside selected scenes", () => {
  const compact = compactStudyExport(v3);
  assert.equal(compact.schemaVersion, 3);
  assert.deepEqual(compact.cues.map(cue => cue.id), ["q", "a"]);
  assert.equal(compact.sections[0].focusItems[0].examples.length, 1);
});
