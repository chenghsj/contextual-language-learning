import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GenerationRequestSchema,
  LearningDocumentSchema,
  createSceneJob,
  learningDocumentToMarkdown,
} from "@immersive/core";
import { FileDocumentRepository, FileJobRepository, localStoragePorts } from "./file";
import { videoFolder } from "./video-folders";

test("job records survive repository restarts and invalid IDs cannot traverse directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-store-"));
  try {
    const id = randomUUID();
    const job = createSceneJob(
      GenerationRequestSchema.parse({
        id,
        source: { platform: "import", title: "Save test" },
        profile: {
          targetLanguage: "en",
          instructionLanguage: "en",
          level: "B1",
          sceneCount: 2,
          contextualExampleCount: 1,
        },
        agent: { provider: "openai", modelId: "" },
        cues: [{ id: "cue-1", startMs: null, endMs: null, originalText: "Hello" }],
      }),
      1,
    );
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

test("V5 library ignores older flat files without deleting them and groups new lessons by video", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-v4-"));
  try {
    const oldId = randomUUID();
    await writeFile(join(root, oldId + ".json"), JSON.stringify({ schemaVersion: 3 }));
    const storage = localStoragePorts(join(root, "data-v5"));
    assert.deepEqual(await storage.documents.list(), []);
    const document = LearningDocumentSchema.parse({
      id: randomUUID(),
      schemaVersion: 5,
      createdAt: new Date().toISOString(),
      source: {
        platform: "youtube",
        title: "Episode / One",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      profile: {
        targetLanguage: "en",
        instructionLanguage: "en",
        level: "B1",
        sceneCount: 2,
        contextualExampleCount: 1,
      },
      generation: { provider: "openai", modelId: "" },
      cues: [
        { id: "q", startMs: 0, endMs: 1000, originalText: "Hello" },
        { id: "a", startMs: 1100, endMs: 2000, originalText: "Hi" },
      ],
      sections: [
        {
          id: randomUUID(),
          title: "Hello",
          context: "Greeting",
          cueIds: ["q", "a"],
          startMs: 0,
          endMs: 2000,
          translations: [
            { cueId: "q", text: "Hello" },
            { cueId: "a", text: "Hi" },
          ],
          focusItems: [
            {
              expression: "Hello",
              sourceCueIds: ["q"],
              meaning: "Hello",
              contextExplanation: "The reply shows a greeting.",
              contextCueIds: ["a"],
              wordNotes: [],
              examples: [
                {
                  situation: "Meeting",
                  dialogue: [
                    { text: "Hello", translation: "Hello" },
                    { text: "Hi", translation: "Hi" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    await storage.documents.save(document, learningDocumentToMarkdown(document));
    const folder = await videoFolder(join(root, "data-v5"), document);
    assert.equal((await storage.documents.list())[0]?.id, document.id);
    assert.equal(await readFile(join(root, oldId + ".json"), "utf8"), '{"schemaVersion":3}');
    assert.match(await readFile(join(folder, document.id + ".md"), "utf8"), /Focus expressions/);
    const renamed = {
      ...document,
      id: randomUUID(),
      source: { ...document.source, title: "New title" },
    };
    await storage.documents.save(renamed, learningDocumentToMarkdown(renamed));
    assert.equal(await videoFolder(join(root, "data-v5"), renamed), folder);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a completed V5 cue calibration persists atomically and cannot alter source timestamps", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-calibration-"));
  try {
    const id = randomUUID();
    const repo = new FileDocumentRepository(root);
    const doc = LearningDocumentSchema.parse({
      id,
      schemaVersion: 5,
      createdAt: new Date().toISOString(),
      source: { platform: "import", title: "Calibration" },
      profile: {
        targetLanguage: "en",
        instructionLanguage: "en",
        level: "B1",
        sceneCount: 2,
        contextualExampleCount: 1,
      },
      generation: { provider: "anthropic", modelId: "" },
      cues: [
        { id: "q", startMs: 1000, endMs: 2000, originalText: "What about dinner?" },
        { id: "a", startMs: 2100, endMs: 3300, originalText: "Not decided yet." },
      ],
      sections: [
        {
          id: randomUUID(),
          title: "Dinner",
          context: "A dinner conversation",
          learningGoal: "Learn an undecided plan",
          cueIds: ["q", "a"],
          focusCueIds: ["a"],
          startMs: 1000,
          endMs: 3300,
          translations: [
            { cueId: "q", text: "What about dinner?" },
            { cueId: "a", text: "Not decided yet." },
          ],
          vocabulary: [],
          insights: [],
          exercises: [],
          focusItems: [
            {
              expression: "Not decided yet.",
              sourceCueIds: ["a"],
              meaning: "Undecided",
              contextExplanation: "The question provides the context.",
              contextCueIds: ["q"],
              wordNotes: [],
              examples: [
                {
                  situation: "Plans",
                  dialogue: [
                    { text: "Dinner?", translation: "Dinner?" },
                    { text: "Not decided yet.", translation: "Not decided yet." },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(doc.schemaVersion, 5);
    await repo.save(doc, learningDocumentToMarkdown(doc));
    const folder = await videoFolder(root, doc);
    const saved = await repo.updatePlaybackRange(id, "a", { startMs: 2300, endMs: 3700 });
    assert.equal(saved.schemaVersion, 5);
    if (saved.schemaVersion !== 5) throw new Error("Unexpected version");
    assert.deepEqual(saved.playbackOverrides?.a, { startMs: 2300, endMs: 3700 });
    assert.deepEqual(saved.scenePlaybackOverrides?.[doc.sections[0].id], {
      startMs: 1000,
      endMs: 3700,
    });
    assert.equal(saved.cues.find(cue => cue.id === "a")?.startMs, 2100);
    const fresh = await new FileDocumentRepository(root).get(id);
    assert.equal(fresh?.schemaVersion, 5);
    if (fresh?.schemaVersion !== 5) throw new Error("Unexpected disk document");
    assert.deepEqual(fresh.playbackOverrides?.a, { startMs: 2300, endMs: 3700 });
    assert.deepEqual(fresh.scenePlaybackOverrides?.[doc.sections[0].id], {
      startMs: 1000,
      endMs: 3700,
    });
    assert.match(await readFile(join(folder, id + ".md"), "utf8"), /User-calibrated playback/);
    const sceneId = doc.sections[0].id;
    const sceneSaved = await repo.updateScenePlaybackRange(id, sceneId, {
      startMs: 800,
      endMs: 3800,
    });
    if (sceneSaved.schemaVersion !== 5) throw new Error("Unexpected version");
    assert.deepEqual(sceneSaved.scenePlaybackOverrides?.[sceneId], { startMs: 800, endMs: 3800 });
    assert.equal(sceneSaved.sections[0].startMs, 1000);
    assert.equal(sceneSaved.cues[0].startMs, 1000);
    const sceneFresh = await new FileDocumentRepository(root).get(id);
    if (sceneFresh?.schemaVersion !== 5) throw new Error("Unexpected persisted scene document");
    assert.deepEqual(sceneFresh.scenePlaybackOverrides?.[sceneId], { startMs: 800, endMs: 3800 });
    assert.match(
      await readFile(join(folder, id + ".md"), "utf8"),
      /User-calibrated scene playback/,
    );
    await assert.rejects(
      repo.updateScenePlaybackRange(id, randomUUID(), null),
      /not part of this lesson/,
    );
    const sceneRestored = await repo.updateScenePlaybackRange(id, sceneId, null);
    if (sceneRestored.schemaVersion !== 5) throw new Error("Unexpected version");
    assert.deepEqual(sceneRestored.scenePlaybackOverrides, {});
    await assert.rejects(repo.updatePlaybackRange(id, "missing", null), /not part of this lesson/);
    const restored = await repo.updatePlaybackRange(id, "a", null);
    assert.equal(restored.schemaVersion, 5);
    if (restored.schemaVersion !== 5) throw new Error("Unexpected version");
    assert.deepEqual(restored.playbackOverrides, {});
    assert.equal(restored.cues.find(cue => cue.id === "a")?.startMs, 2100);
    await assert.rejects(
      repo.updatePlaybackRange(id, "a", { startMs: 4000, endMs: 1000 }),
      /Playback duration|Invalid|validation/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleting history removes ended checkpoints and rejects active jobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-history-"));
  try {
    const repo = new FileJobRepository(root);
    for (const status of ["queued", "running", "waiting", "failed", "cancelled"] as const) {
      const id = randomUUID();
      const job = createSceneJob(
        GenerationRequestSchema.parse({
          id,
          source: { platform: "import", title: "History" },
          profile: {
            targetLanguage: "en",
            instructionLanguage: "en",
            level: "B1",
            sceneCount: 2,
            contextualExampleCount: 1,
          },
          agent: { provider: "openai", modelId: "" },
          cues: [{ id: "cue", startMs: null, endMs: null, originalText: "Hello" }],
        }),
        1,
      );
      job.summary.status = status;
      await repo.create(job);
      if (status === "failed" || status === "cancelled") {
        await repo.deleteHistory(id);
        await repo.deleteHistory(id);
        assert.equal(await repo.get(id), null);
        assert.equal(await repo.getRecord(id), null);
      } else {
        await assert.rejects(repo.deleteHistory(id), /Only ended/);
        assert.equal((await repo.get(id))?.summary.status, status);
      }
    }
    await assert.rejects(repo.deleteHistory("../../other"), /Invalid repository ID/);
    assert.equal((await repo.list()).length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
