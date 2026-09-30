import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema } from "@immersive/core";
import { JobManager } from "../jobs/manager";
import { localStoragePorts } from "./file";
import { publishSavedJob } from "./publish";
import { backupSavedJob } from "./backup";

test("publication failure preserves finished material; retry never regenerates", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-publication-"));
  try {
    const storage = localStoragePorts(root);
    const request = GenerationRequestSchema.parse({
      id: randomUUID(), source: { platform: "import", title: "Test" },
      profile: { targetLanguage: "en", instructionLanguage: "en",
        level: "A2", mode: "guided", maxNewVocabulary: 2, exerciseCount: 1 },
      agent: { provider: "custom-" + "a".repeat(24), modelId: "" },
      destination: { kind: "local", directory: root },
      backup: { enabled: true, accountId: "fake-test-account" },
      cues: [{ id: "cue-1", startMs: null, endMs: null, originalText: "Hello" }],
    });
    let generated = 0;
    const manager = new JobManager({
      storage, legacyGeneration: true, generateSection: async () => {
        generated += 1;
        return { title: "Hello", context: "Context", vocabulary: [], insights: [], exercises: [] };
      },
    }, () => undefined);
    const document = await manager.start(request.id, request);
    assert.equal(generated, 1);
    const local = await publishSavedJob(storage, document.id, {
      publish: async (_document, _markdown, destination) => {
        assert.equal(destination.kind, "local");
        return join(root, document.id + ".json");
      },
    });
    assert.match(local, /[.]json$/);
    assert.equal((await storage.jobs.get(document.id))?.summary.publication?.status, "published");
    await assert.rejects(backupSavedJob(storage, document.id, async () => {
      throw new Error("Drive offline");
    }), /Drive offline/);
    assert.equal((await storage.jobs.get(document.id))?.summary.status, "completed");
    assert.equal((await storage.jobs.get(document.id))?.summary.backup?.status, "failed");
    assert.equal((await storage.documents.get(document.id))?.id, document.id);
    const uri = await backupSavedJob(storage, document.id, async () =>
      "https://drive.google.com/file/d/example/view");
    assert.equal(uri, "https://drive.google.com/file/d/example/view");
    assert.equal((await storage.jobs.get(document.id))?.summary.backup?.status, "backed-up");
    assert.equal(generated, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("V3 contextual documents survive local storage and Drive backup without losing focus content", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-v3-backup-"));
  try {
    const storage = localStoragePorts(root);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const request = GenerationRequestSchema.parse({
      id, lessonFormat: "contextual-v3",
      source: { platform: "youtube", title: "V3 backup" },
      profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
        mode: "adaptive", maxNewVocabulary: 1, exerciseCount: 0, sceneCount: 1, contextualExampleCount: 1 },
      agent: { provider: "custom-" + "a".repeat(24), modelId: "" },
      backup: { enabled: true, accountId: "fake-v3-account" },
      cues: [
        { id: "q", startMs: 1000, endMs: 1900, originalText: "What about dinner?" },
        { id: "a", startMs: 2000, endMs: 3200, originalText: "I haven't decided yet." },
      ],
    });
    const section = {
      id: randomUUID(), title: "Dinner", context: "A real dinner-planning exchange.",
      learningGoal: "Understand an undecided plan.", cueIds: ["q", "a"], focusCueIds: ["a"],
      startMs: 1000, endMs: 3200,
      translations: [{ cueId: "q", text: "晚餐呢？" }, { cueId: "a", text: "我還沒決定。" }],
      vocabulary: [], insights: [], exercises: [],
      focusItems: [{
        expression: "I haven't decided yet.", sourceCueIds: ["a"], meaning: "我還沒決定。",
        contextExplanation: "The prior question supplies the context.", contextCueIds: ["q"],
        wordNotes: [], examples: [{ situation: "A trip decision", dialogue: [
          { text: "Have you decided?", translation: "你決定了嗎？" },
          { text: "I haven't decided yet.", translation: "我還沒決定。" },
        ] }],
      }],
    };
    const document = {
      id, schemaVersion: 3 as const, createdAt, source: request.source, profile: request.profile,
      generation: request.agent, cues: request.cues, sections: [section],
    };
    const { JobSnapshotSchema } = await import("@immersive/core");
    const job = JobSnapshotSchema.parse({
      schemaVersion: 1, request, sections: [section],
      summary: {
        id, sourceTitle: request.source.title, provider: request.agent.provider,
        status: "completed", completed: 1, total: 1, createdAt, updatedAt: createdAt,
        documentId: id, publication: { status: "published", location: join(root, id + ".json") },
      },
    });
    await storage.jobs.create(job);
    const { toMarkdown } = await import("../generation/markdown");
    await storage.documents.save(document, toMarkdown(document));
    const restored = await storage.documents.get(id);
    assert.equal(restored?.schemaVersion, 3);
    assert.equal(restored && restored.schemaVersion === 3
      ? restored.sections[0].focusItems[0].expression : "", "I haven't decided yet.");

    const location = await backupSavedJob(storage, id, async (_accountId, uploaded, markdown) => {
      assert.equal(uploaded.schemaVersion, 3);
      assert.match(markdown, /AI-created contextual examples/);
      assert.match(markdown, /A trip decision/);
      return "https://drive.google.com/file/d/v3/view";
    });
    assert.equal(location, "https://drive.google.com/file/d/v3/view");
    assert.equal((await storage.jobs.get(id))?.summary.backup?.status, "backed-up");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
