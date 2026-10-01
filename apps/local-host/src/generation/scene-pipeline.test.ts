import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, type JobSummary } from "@immersive/core";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "../storage/file";
import { chooseFinalScenes, validateCandidateBatch } from "./scene-pipeline";

const rawCues = [
  { id: "cue-1", startMs: 1000, endMs: 3000, originalText: "How are you?" },
  { id: "cue-2", startMs: 3500, endMs: 5500, originalText: "I'm fine, thanks." },
  { id: "cue-3", startMs: 310_000, endMs: 313_000, originalText: "Could you help me?" },
  { id: "cue-4", startMs: 313_500, endMs: 317_000, originalText: "Sure, what do you need?" },
];

test("curation rejects invented source references and requires neighboring evidence", () => {
  assert.throws(() => validateCandidateBatch(rawCues, {
    candidates: [{ cueIds: ["cue-404"], focusExpressions: ["imagined"], learningGoal: "hello" }],
  }, 0), /outside/);
  assert.throws(() => validateCandidateBatch(rawCues, {
    candidates: [{ cueIds: ["cue-1"], focusExpressions: ["imagined"], learningGoal: "hello" }],
  }, 0), /not present/);
  assert.deepEqual(validateCandidateBatch(rawCues, {
    candidates: [{ cueIds: ["cue-1"], focusExpressions: ["How are you?"], learningGoal: "hello" }],
  }, 0), [], "a single cue cannot support contextual evidence");
  const candidate = { id: "candidate-1-1", cueIds: ["cue-1", "cue-2"],
    focusExpressions: ["How are you?"], learningGoal: "Ask a friend" };
  assert.throws(() => chooseFinalScenes({ selectedCandidateIds: ["missing"] },
    [candidate], { profile: { sceneCount: 2 } }, rawCues), /unknown/);
});

test("candidate checkpoints survive interruption and V4 resume skips completed work", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-scenes-"));
  try {
    const storage = localStoragePorts(root);
    const request = GenerationRequestSchema.parse({
      id: randomUUID(), source: { platform: "import", title: "Everyday dialogue" },
      profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
        sceneCount: 2, contextualExampleCount: 1 },
      agent: { provider: "openai", modelId: "" }, cues: rawCues,
    });
    const counts = { candidates: 0, selection: 0, scenes: 0 };
    const deps = {
      storage,
      generateCandidates: async (_agent: unknown, prompt: string) => {
        counts.candidates++;
        return { candidates: [prompt.includes("chunk 1 of 2")
          ? { cueIds: ["cue-1", "cue-2"], focusExpressions: ["How are you?"], learningGoal: "Ask how someone is" }
          : { cueIds: ["cue-3", "cue-4"], focusExpressions: ["Could you help me?"], learningGoal: "Ask for help" }] };
      },
      generateSelection: async () => {
        counts.selection++;
        return { selectedCandidateIds: ["candidate-1-1", "candidate-2-1"] };
      },
      generateSection: async (_agent: unknown, prompt: string) => {
        counts.scenes++;
        const first = prompt.includes("How are you?");
        const expression = first ? "How are you?" : "Could you help me?";
        const source = first ? "cue-1" : "cue-3";
        const context = first ? "cue-2" : "cue-4";
        return {
          title: first ? "Checking in" : "Asking for help", context: "A source-backed exchange.",
          translations: first
            ? [{ cueId: "cue-1", text: "你好嗎？" }, { cueId: "cue-2", text: "我很好，謝謝。" }]
            : [{ cueId: "cue-3", text: "可以幫我嗎？" }, { cueId: "cue-4", text: "可以，你需要什麼？" }],
          focusItems: [{ expression, sourceCueIds: [source], meaning: "實用表達",
            contextExplanation: "The neighboring reply supports this meaning.", contextCueIds: [context],
            wordNotes: [], examples: [{ situation: "A similar conversation", dialogue: [
              { text: expression, translation: "實用表達" }, { text: "Sure.", translation: "好的。" },
            ] }],
          }],
        };
      },
    };
    const aborted = new AbortController();
    const first = new JobManager(deps, (_id: string, summary: JobSummary) => {
      if (summary.completed === 1 && summary.status === "running") aborted.abort();
    });
    await assert.rejects(first.start(request.id, request, aborted.signal), /interrupt/);
    assert.equal((await storage.jobs.get(request.id))?.scenePlan.candidateChunks.length, 1);
    assert.equal(await first.cancel(request.id), true);
    assert.equal((await storage.jobs.get(request.id))?.summary.status, "cancelled");
    const resumed = new JobManager(deps, () => undefined);
    const document = await resumed.resume(randomUUID(), request.id);
    assert.equal(document.schemaVersion, 4);
    assert.equal(document.sections.length, 2);
    assert.deepEqual(counts, { candidates: 2, selection: 1, scenes: 2 });
    assert.equal((await storage.jobs.get(request.id))?.summary.status, "completed");
    // Simulate a crash after canonical save but before the completed checkpoint.
    await storage.jobs.update(request.id, current => ({
      ...current, summary: { ...current.summary, status: "failed", documentId: undefined },
    }));
    const recovered = await resumed.resume(randomUUID(), request.id);
    assert.equal(JSON.stringify(recovered), JSON.stringify(document));
    assert.deepEqual(counts, { candidates: 2, selection: 1, scenes: 2 });
    assert.equal((await storage.jobs.get(request.id))?.summary.status, "completed");
    const calibrated = await storage.documents.updatePlaybackRange(request.id, "cue-1",
      { startMs: 900, endMs: 3200 });
    await storage.jobs.update(request.id, current => ({
      ...current, summary: { ...current.summary, status: "failed", documentId: undefined },
    }));
    await assert.rejects(resumed.resume(randomUUID(), request.id), /conflicts/);
    assert.deepEqual(await storage.documents.get(request.id), calibrated,
      "a conflicting resume cannot replace the saved, calibrated lesson");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
