import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, LearningDocumentSchema, readLearningDocument } from "@immersive/core";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "../storage/file";
import { toMarkdown } from "./markdown";
import { assembleContextualScene, validateCandidateBatch } from "./scene-pipeline";
import { contextualScenePrompt } from "./scene-prompts";

const cues = [
  { id: "cue-1", startMs: 1_000, endMs: 2_000, originalText: "What about dinner?" },
  { id: "cue-2", startMs: 2_100, endMs: 4_000, originalText: "I haven't decided yet." },
  { id: "cue-3", startMs: 4_200, endMs: 5_500, originalText: "Let's decide tomorrow." },
];
const candidate = {
  id: "candidate-1-1", cueIds: cues.map(cue => cue.id),
  focusExpressions: ["I haven't decided yet."], learningGoal: "Explain an undecided plan",
};
const examples = [
  { situation: "A friend asks about your trip.", dialogue: [
    { text: "Have you chosen the trip?", translation: "你選好旅行了嗎？" },
    { text: "I haven't decided yet.", translation: "我還沒決定。" },
  ] },
  { situation: "A colleague asks about lunch.", dialogue: [
    { text: "What are you having for lunch?", translation: "午餐要吃什麼？" },
    { text: "I haven't decided yet.", translation: "我還沒決定。" },
  ] },
];
function content() {
  return {
    title: "Making a plan", context: "Someone is asked about dinner and has not made a decision.",
    translations: cues.map(cue => ({ cueId: cue.id, text: "翻譯" })),
    focusItems: [{
      expression: candidate.focusExpressions[0], sourceCueIds: ["cue-2"],
      meaning: "我還沒決定",
      contextExplanation: "The dinner question and suggestion to decide tomorrow establish an undecided plan.",
      contextCueIds: ["cue-1", "cue-3"],
      wordNotes: [{ surface: "yet", meaning: "尚未", explanation: "Indicates no decision so far." }],
      examples,
    }],
  };
}
function request() {
  return GenerationRequestSchema.parse({
    id: randomUUID(), lessonFormat: "contextual-v3",
    source: { platform: "import", title: "Video dialogue" }, cues,
    profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
      mode: "adaptive", sceneCount: 1, maxNewVocabulary: 1, exerciseCount: 0,
      contextualExampleCount: 2 },
    agent: { provider: "claude", modelId: "" },
  });
}

test("V3 maps contextual learning to original cue times, counts and saved documents", () => {
  const section = assembleContextualScene(candidate, cues, content(), 1, 2);
  assert.deepEqual(section.focusCueIds, ["cue-2"]);
  assert.equal(section.startMs, 1_000);
  assert.equal(section.endMs, 5_500);
  assert.equal(section.focusItems[0].examples.length, 2);
  assert.equal(section.exercises.length, 0);
  const doc = LearningDocumentSchema.parse({
    id: randomUUID(), schemaVersion: 3, createdAt: new Date().toISOString(),
    source: { platform: "import", title: "Example" }, profile: request().profile,
    generation: { provider: "claude", modelId: "" }, cues, sections: [section],
  });
  if (doc.schemaVersion !== 3) throw new Error("Unexpected lesson version");
  assert.equal(readLearningDocument(doc).schemaVersion, 3);
  assert.equal(doc.sections[0].focusItems[0].examples.length, 2);
  assert.match(toMarkdown(doc), /AI-created contextual examples/);
  assert.doesNotMatch(toMarkdown(doc), /### Practice/);
});

test("V3 rejects invented cue references, ungrounded word notes and invalid examples", () => {
  assert.throws(() => assembleContextualScene(candidate, cues, {
    ...content(), focusItems: [{ ...content().focusItems[0], sourceCueIds: ["cue-404"] }],
  }, 1, 2), /source cue IDs/);
  assert.throws(() => assembleContextualScene(candidate, cues, {
    ...content(), focusItems: [{ ...content().focusItems[0], contextCueIds: ["cue-404"] }],
  }, 1, 2), /context evidence/i);
  assert.throws(() => assembleContextualScene(candidate, cues, {
    ...content(), focusItems: [{ ...content().focusItems[0],
      wordNotes: [{ surface: "imagined", meaning: "X", explanation: "X" }] }],
  }, 1, 2), /word notes/i);
  assert.throws(() => assembleContextualScene(candidate, cues, {
    ...content(), focusItems: [{ ...content().focusItems[0], examples: examples.slice(0, 1) }],
  }, 1, 2), /example count/i);
  assert.throws(() => assembleContextualScene(candidate, cues, {
    ...content(), focusItems: [{ ...content().focusItems[0], examples: [examples[0], {
      situation: "Another topic", dialogue: [
        { text: "Are you free?", translation: "有空嗎？" },
        { text: "Yes.", translation: "有。" },
      ],
    }] }],
  }, 1, 2), /focus expression/i);
});

test("V3 prompt distinguishes evidence-based video explanations and AI-created contexts", () => {
  const prompt = contextualScenePrompt(request(), candidate, cues, 1, 2);
  assert.match(prompt, /EXACTLY 2 contextual examples PER focus expression/);
  assert.match(prompt, /ACTUAL neighboring source cues/);
  assert.match(prompt, /NEVER imply examples appeared in the original video/);
  assert.ok(prompt.includes("cue-1") && prompt.includes("cue-3"));
});

test("V3 resolves expressions spanning adjacent original subtitle cues", () => {
  const split = [
    { id: "a", startMs: 100, endMs: 500, originalText: "I haven't" },
    { id: "b", startMs: 510, endMs: 900, originalText: "decided yet." },
    { id: "c", startMs: 910, endMs: 1_300, originalText: "Let's decide tomorrow." },
  ];
  const candidates = validateCandidateBatch(split, { candidates: [{
    cueIds: ["a", "b", "c"], focusExpressions: ["I haven't decided yet."], learningGoal: "Decision",
  }] }, 0);
  const splitContent = {
    ...content(), translations: split.map(cue => ({ cueId: cue.id, text: "翻譯" })),
    focusItems: [{ ...content().focusItems[0], sourceCueIds: ["a", "b"], contextCueIds: ["c"] }],
  };
  const scene = assembleContextualScene(candidates[0], split, splitContent, 1, 2);
  assert.deepEqual(scene.focusItems[0].sourceCueIds, ["a", "b"]);
  assert.deepEqual(scene.focusCueIds, ["a"]);
});

test("V3 generation completes through the existing resumable scene job pipeline", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-contextual-"));
  try {
    const storage = localStoragePorts(root);
    const req = request();
    const manager = new JobManager({
      storage,
      generateCandidates: async () => ({ candidates: [{
        cueIds: candidate.cueIds, focusExpressions: candidate.focusExpressions,
        learningGoal: candidate.learningGoal,
      }] }),
      generateSelection: async () => ({ selectedCandidateIds: ["candidate-1-1"] }),
      generateSection: async () => content(),
    }, () => undefined);
    const doc = await manager.start(req.id, req);
    assert.equal(doc.schemaVersion, 3);
    if (doc.schemaVersion !== 3) throw new Error("Unexpected lesson version");
    assert.equal(doc.sections[0].focusItems[0].examples.length, 2);
    assert.equal((await storage.jobs.get(req.id))?.summary.status, "completed");
    assert.equal((await storage.documents.get(req.id))?.schemaVersion, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
