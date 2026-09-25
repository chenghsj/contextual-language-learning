import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, type JobSummary } from "@immersive/core";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "../storage/file";
import { assembleStudyScene, chooseFinalScenes, validateCandidateBatch } from "./scene-pipeline";

const rawCues = [
  { id: "cue-1", startMs: 1000, endMs: 3000, originalText: "How are you?" },
  { id: "cue-2", startMs: 3500, endMs: 5500, originalText: "I'm fine, thanks." },
  { id: "cue-3", startMs: 310_000, endMs: 313_000, originalText: "Could you help me?" },
  { id: "cue-4", startMs: 313_500, endMs: 317_000, originalText: "Sure, what do you need?" },
];

test("model cannot invent cue IDs, focus phrases or translation references", () => {
  assert.throws(() => validateCandidateBatch(rawCues, {
    candidates: [{ cueIds: ["cue-404"], focusExpressions: ["imagined"], learningGoal: "hello" }],
  }, 0), /outside/);
  assert.throws(() => validateCandidateBatch(rawCues, {
    candidates: [{ cueIds: ["cue-1"], focusExpressions: ["imagined"], learningGoal: "hello" }],
  }, 0), /not present/);
  const candidate = { id: "candidate-1-1", cueIds: ["cue-1", "cue-2"],
    focusExpressions: ["How are you?"], learningGoal: "Ask a friend" };
  assert.throws(() => assembleStudyScene(candidate, rawCues, {
    title: "Greeting", context: "Friends meet.", vocabulary: [], insights: [], exercises: [],
    translations: [{ cueId: "cue-1", text: "你好" }, { cueId: "fake", text: "虛構" }],
  }, 1, 0), /translations/);
  assert.throws(() => chooseFinalScenes({
    selectedCandidateIds: ["candidate-nope"],
  }, [candidate], { profile: { sceneCount: 2, maxNewVocabulary: 2 } }, rawCues), /unknown/);
});

test("candidate and selected-scene checkpoints survive an interrupted generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-scenes-"));
  try {
    const storage = localStoragePorts(root);
    const request = GenerationRequestSchema.parse({
      id: randomUUID(), source: { platform: "import", title: "Everyday dialogue" },
      profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
        mode: "adaptive", sceneCount: 2, maxNewVocabulary: 2, exerciseCount: 1 },
      agent: { provider: "claude", modelId: "" }, cues: rawCues,
    });
    const counts = { candidates: 0, selection: 0, scenes: 0 };
    const deps = {
      storage,
      generateCandidates: async (_agent: unknown, prompt: string) => {
        counts.candidates++;
        return prompt.includes("chunk 1 of 2")
          ? { candidates: [{
              cueIds: ["cue-1", "cue-2"], focusExpressions: ["How are you?"], learningGoal: "Ask how someone is",
            }] }
          : { candidates: [{
              cueIds: ["cue-3", "cue-4"], focusExpressions: ["Could you help me?"], learningGoal: "Ask for help",
            }] };
      },
      generateSelection: async () => {
        counts.selection++;
        return { selectedCandidateIds: ["candidate-1-1", "candidate-2-1"] };
      },
      generateSection: async (_agent: unknown, prompt: string) => {
        counts.scenes++;
        const first = prompt.includes("How are you?");
        return {
          title: first ? "Checking in" : "Asking for help",
          context: first ? "Two friends greet each other." : "Someone asks for assistance.",
          translations: first
            ? [{ cueId: "cue-1", text: "你好嗎？" }, { cueId: "cue-2", text: "我很好，謝謝。" }]
            : [{ cueId: "cue-3", text: "可以幫我嗎？" }, { cueId: "cue-4", text: "可以，你需要什麼？" }],
          vocabulary: [{
            expression: first ? "How are you?" : "Could you help me?",
            meaning: first ? "你好嗎？" : "可以幫我嗎？",
            explanation: "A practical expression.", example: first ? "How are you?" : "Could you help me?",
          }],
          insights: [], exercises: first ? [{
            type: "situational", question: "Ask your friend how they are.", answer: "How are you?",
          }] : [],
        };
      },
    };
    const aborted = new AbortController();
    const first = new JobManager(deps, (_id: string, summary: JobSummary) => {
      if (summary.completed === 1 && summary.status === "running") aborted.abort();
    });
    await assert.rejects(first.start(request.id, request, aborted.signal), /interrupt/);
    const checkpoint = await storage.jobs.get(request.id);
    assert.equal(checkpoint?.summary.status, "waiting");
    assert.equal(checkpoint?.scenePlan?.candidateChunks.length, 1);
    assert.equal(counts.candidates, 1);
    const resumed = new JobManager(deps, () => undefined);
    const document = await resumed.resume(randomUUID(), request.id);
    assert.equal(document.schemaVersion, 2);
    assert.equal(document.sections.length, 2);
    assert.equal(counts.candidates, 2, "first candidate must not be regenerated");
    assert.equal(counts.selection, 1);
    assert.equal(counts.scenes, 2);
    assert.equal(document.sections.reduce((n, item) => n + item.vocabulary.length, 0), 2);
    assert.equal(document.sections.reduce((n, item) => n + item.exercises.length, 0), 1);
    assert.equal(document.sections[0].cueIds.length, 2, "only chosen dialogue enters the lesson");
    assert.equal((await storage.jobs.get(request.id))?.summary.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
