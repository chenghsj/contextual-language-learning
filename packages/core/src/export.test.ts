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
  assert.ok(md.includes("Context \\* lesson"));
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


const legacyProfile = {
  targetLanguage: "en" as const, instructionLanguage: "zh-TW" as const, level: "B1",
  mode: "adaptive" as const, maxNewVocabulary: 2, exerciseCount: 1, sceneCount: 2,
};
const legacyBase = {
  id: v3.id, createdAt: v3.createdAt, source: v3.source, generation: v3.generation,
  profile: legacyProfile, cues: v3.cues,
};
const legacyVocabulary = [{
  expression: "decide", meaning: "決定", explanation: "Choose an option.",
  example: "Let's decide tomorrow.",
}];

test("saved V1 lessons still parse and export without dropping historical cues or practice", () => {
  const v1 = LearningDocumentSchema.parse({
    ...legacyBase, schemaVersion: 1,
    sections: [{
      id: "00000000-0000-4000-8000-000000000002", title: "Old study card",
      context: "The dinner conversation.", cueIds: ["q", "a"],
      startMs: 1000, endMs: 3300,
      vocabulary: legacyVocabulary, insights: ["Still deciding"],
      exercises: [{ question: "What is undecided?", answer: "Dinner" }],
    }],
  });
  const compact = compactStudyExport(v1);
  assert.equal(compact.schemaVersion, 1);
  assert.equal(compact.cues.length, 3, "V1 keeps its complete original transcript");
  assert.equal(LearningDocumentSchema.parse(JSON.parse(JSON.stringify(compact))).schemaVersion, 1);
  const md = learningDocumentToMarkdown(v1);
  assert.match(md, /Old study card/);
  assert.match(md, /### Vocabulary/);
  assert.match(md, /decide/);
  assert.match(md, /### Practice/);
  assert.match(md, /What is undecided/);
  assert.doesNotMatch(md, /AI-created contextual examples/);
});

test("saved V2 lessons still parse and export translations and exercises without V3 focus items", () => {
  const v2 = LearningDocumentSchema.parse({
    ...legacyBase, schemaVersion: 2,
    sections: [{
      id: "00000000-0000-4000-8000-000000000002", title: "Old contextual scene",
      context: "The dinner conversation.", learningGoal: "Understand a decision.",
      cueIds: ["q", "a"], focusCueIds: ["a"], startMs: 1000, endMs: 3300,
      translations: [{ cueId: "a", text: "我還沒決定。" }],
      vocabulary: legacyVocabulary, insights: ["Still deciding"],
      exercises: [{ type: "situational", question: "What is undecided?", answer: "Dinner" }],
    }],
  });
  const compact = compactStudyExport(v2);
  assert.equal(compact.schemaVersion, 2);
  assert.deepEqual(compact.cues.map(cue => cue.id), ["q", "a"]);
  assert.equal(LearningDocumentSchema.parse(JSON.parse(JSON.stringify(compact))).schemaVersion, 2);
  const md = learningDocumentToMarkdown(v2);
  assert.match(md, /Old contextual scene/);
  assert.match(md, /我還沒決定/);
  assert.match(md, /### Vocabulary/);
  assert.match(md, /### Practice/);
  assert.doesNotMatch(md, /AI-created contextual examples/);
});
