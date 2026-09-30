import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, LearningDocumentSchema, createJob, learningDocumentToMarkdown } from "@immersive/core";
import { FileDocumentRepository, FileJobRepository } from "./file";

test("job records survive repository restarts and invalid IDs cannot traverse directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-store-"));
  try {
    const id = randomUUID();
    const job = createJob(GenerationRequestSchema.parse({
      id, source: { platform: "import", title: "Save test" },
      profile: { targetLanguage: "en", instructionLanguage: "en", level: "B1",
        mode: "guided", maxNewVocabulary: 2, exerciseCount: 1 },
      agent: { provider: "custom-" + "a".repeat(24), modelId: "" },
      cues: [{ id: "cue-1", startMs: null, endMs: null, originalText: "Hello" }],
    }), 1);
    await new FileJobRepository(root).create(job);
    assert.equal((await new FileJobRepository(root).get(id))?.summary.sourceTitle, "Save test");
    await assert.rejects(new FileJobRepository(root).get("../../secrets"), /Invalid repository ID/);
    await assert.rejects(new FileJobRepository(root).create(job), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt checkpoint files fail visibly instead of silently resetting job progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-store-"));
  try {
    const id = randomUUID();
    const folder = join(root, "jobs");
    await import("node:fs/promises").then(fs => fs.mkdir(folder));
    await writeFile(join(folder, id + ".json"), "{corrupt");
    await assert.rejects(new FileJobRepository(root).get(id), /Cannot load saved job/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a completed V3 cue calibration persists atomically and cannot alter source timestamps", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-calibration-"));
  try {
    const id = randomUUID();
    const repo = new FileDocumentRepository(root);
    const doc = LearningDocumentSchema.parse({
      id, schemaVersion: 3, createdAt: new Date().toISOString(),
      source: { platform: "import", title: "Calibration" },
      profile: { targetLanguage: "en", instructionLanguage: "en", level: "B1",
        mode: "adaptive", maxNewVocabulary: 1, exerciseCount: 0, sceneCount: 1 },
      generation: { provider: "claude", modelId: "" },
      cues: [
        { id: "q", startMs: 1000, endMs: 2000, originalText: "What about dinner?" },
        { id: "a", startMs: 2100, endMs: 3300, originalText: "Not decided yet." },
      ],
      sections: [{
        id: randomUUID(), title: "Dinner", context: "A dinner conversation",
        learningGoal: "Learn an undecided plan", cueIds: ["q", "a"],
        focusCueIds: ["a"], startMs: 1000, endMs: 3300,
        translations: [{ cueId: "q", text: "What about dinner?" }, { cueId: "a", text: "Not decided yet." }],
        vocabulary: [], insights: [], exercises: [],
        focusItems: [{
          expression: "Not decided yet.", sourceCueIds: ["a"], meaning: "Undecided",
          contextExplanation: "The question provides the context.", contextCueIds: ["q"],
          wordNotes: [], examples: [{ situation: "Plans", dialogue: [
            { text: "Dinner?", translation: "Dinner?" },
            { text: "Not decided yet.", translation: "Not decided yet." },
          ] }],
        }],
      }],
    });
    assert.equal(doc.schemaVersion, 3);
    await repo.save(doc, learningDocumentToMarkdown(doc));
    const saved = await repo.updatePlaybackRange(id, "a", { startMs: 2300, endMs: 3700 });
    assert.equal(saved.schemaVersion, 3);
    if (saved.schemaVersion !== 3) throw new Error("Unexpected version");
    assert.deepEqual(saved.playbackOverrides?.a, { startMs: 2300, endMs: 3700 });
    assert.equal(saved.cues.find(cue => cue.id === "a")?.startMs, 2100);
    const fresh = await new FileDocumentRepository(root).get(id);
    assert.equal(fresh?.schemaVersion, 3);
    if (fresh?.schemaVersion !== 3) throw new Error("Unexpected disk document");
    assert.deepEqual(fresh.playbackOverrides?.a, { startMs: 2300, endMs: 3700 });
    assert.match(await readFile(join(root, id + ".md"), "utf8"), /User-calibrated playback/);
    const sceneId = doc.sections[0].id;
    const sceneSaved = await repo.updateScenePlaybackRange(id, sceneId, { startMs: 800, endMs: 3800 });
    if (sceneSaved.schemaVersion !== 3) throw new Error("Unexpected version");
    assert.deepEqual(sceneSaved.scenePlaybackOverrides?.[sceneId], { startMs: 800, endMs: 3800 });
    assert.equal(sceneSaved.sections[0].startMs, 1000);
    assert.equal(sceneSaved.cues[0].startMs, 1000);
    const sceneFresh = await new FileDocumentRepository(root).get(id);
    if (sceneFresh?.schemaVersion !== 3) throw new Error("Unexpected persisted scene document");
    assert.deepEqual(sceneFresh.scenePlaybackOverrides?.[sceneId], { startMs: 800, endMs: 3800 });
    assert.match(await readFile(join(root, id + ".md"), "utf8"), /User-calibrated scene playback/);
    await assert.rejects(repo.updateScenePlaybackRange(id, randomUUID(), null), /not part of this lesson/);
    const sceneRestored = await repo.updateScenePlaybackRange(id, sceneId, null);
    if (sceneRestored.schemaVersion !== 3) throw new Error("Unexpected version");
    assert.deepEqual(sceneRestored.scenePlaybackOverrides, {});
    await assert.rejects(repo.updatePlaybackRange(id, "missing", null), /not part of this lesson/);
    const restored = await repo.updatePlaybackRange(id, "a", null);
    assert.equal(restored.schemaVersion, 3);
    if (restored.schemaVersion !== 3) throw new Error("Unexpected version");
    assert.deepEqual(restored.playbackOverrides, {});
    assert.equal(restored.cues.find(cue => cue.id === "a")?.startMs, 2100);
    await assert.rejects(repo.updatePlaybackRange(id, "a", { startMs: 4000, endMs: 1000 }),
      /Playback duration|Invalid|validation/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
