import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, JobSnapshotSchema, LearningDocumentSchema } from "@immersive/core";
import { localStoragePorts } from "./file";
import { publishSavedJob } from "./publish";
import { backupSavedJob } from "./backup";
import { toMarkdown } from "../generation/markdown";

async function completedLesson(root: string) {
  const storage = localStoragePorts(root);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const request = GenerationRequestSchema.parse({
    id, source: { platform: "import", title: "Dinner" },
    profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
      sceneCount: 2, contextualExampleCount: 1 },
    agent: { provider: "custom-" + "a".repeat(24), modelId: "" },
    backup: { enabled: true, accountId: "fake-account" },
    cues: [
      { id: "q", startMs: 1000, endMs: 1900, originalText: "What about dinner?" },
      { id: "a", startMs: 2000, endMs: 3200, originalText: "I haven't decided yet." },
    ],
  });
  const candidate = { id: "candidate-1-1", cueIds: ["q", "a"],
    focusExpressions: ["I haven't decided yet."], learningGoal: "Understand an undecided plan" };
  const scene = {
    id: randomUUID(), title: "Dinner", context: "A real dinner-planning exchange.",
    cueIds: ["q", "a"], startMs: 1000, endMs: 3200,
    translations: [{ cueId: "q", text: "晚餐呢？" }, { cueId: "a", text: "我還沒決定。" }],
    focusItems: [{ expression: "I haven't decided yet.", sourceCueIds: ["a"],
      meaning: "我還沒決定。", contextExplanation: "The prior question supplies the context.",
      contextCueIds: ["q"], wordNotes: [], examples: [{ situation: "A trip decision", dialogue: [
        { text: "Have you decided?", translation: "你決定了嗎？" },
        { text: "I haven't decided yet.", translation: "我還沒決定。" },
      ] }],
    }],
  };
  const document = LearningDocumentSchema.parse({
    id, schemaVersion: 4, createdAt, source: request.source, profile: request.profile,
    generation: request.agent, cues: request.cues, sections: [scene],
  });
  const job = JobSnapshotSchema.parse({
    schemaVersion: 2, request, sections: [scene],
    scenePlan: { candidateChunks: [[candidate]], selected: [candidate] },
    summary: { id, sourceTitle: request.source.title, provider: request.agent.provider,
      status: "completed", completed: 3, total: 3, createdAt, updatedAt: createdAt, documentId: id },
  });
  await storage.jobs.create(job);
  await storage.documents.save(document, toMarkdown(document));
  return { storage, document };
}

test("publication and Drive failures retain canonical V4 material; retries do not generate again", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-publication-"));
  try {
    const { storage, document } = await completedLesson(root);
    await assert.rejects(publishSavedJob(storage, document.id, {
      publish: async () => { throw new Error("Disk unavailable"); },
    }), /Disk unavailable/);
    assert.equal((await storage.jobs.get(document.id))?.summary.status, "completed");
    assert.equal((await storage.documents.get(document.id))?.id, document.id);
    const local = await publishSavedJob(storage, document.id, {
      publish: async () => join(root, document.id + ".json"),
    });
    assert.match(local, /[.]json$/);
    await assert.rejects(backupSavedJob(storage, document.id, async () => {
      throw new Error("Drive offline");
    }), /Drive offline/);
    assert.equal((await storage.jobs.get(document.id))?.summary.backup?.status, "failed");
    const uri = await backupSavedJob(storage, document.id, async (_accountId, uploaded, markdown) => {
      assert.equal(uploaded.schemaVersion, 4);
      assert.match(markdown, /AI-created contextual examples/);
      return "https://drive.google.com/file/d/example/view";
    });
    assert.equal(uri, "https://drive.google.com/file/d/example/view");
    assert.equal((await storage.jobs.get(document.id))?.summary.backup?.status, "backed-up");
    assert.equal((await storage.documents.get(document.id))?.sections[0].focusItems[0].expression,
      "I haven't decided yet.");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deleting completed history preserves lessons and operational metadata without transcripts or checkpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-delete-completed-"));
  try {
    const { storage, document } = await completedLesson(root);
    const before = await storage.documents.get(document.id);
    await storage.jobs.deleteHistory(document.id);
    assert.equal(await storage.jobs.get(document.id), null);
    assert.deepEqual(await storage.jobs.list(), []);
    assert.deepEqual(await storage.documents.get(document.id), before);
    const fresh = localStoragePorts(root);
    const record = await fresh.jobs.getRecord(document.id);
    assert.equal(record?.summary.documentId, document.id);
    assert.deepEqual(Object.keys(record!.request), ["backup"]);
    const raw = await import("node:fs/promises").then(fs => fs.readFile(join(root, "lesson-records", document.id + ".json"), "utf8"));
    assert.doesNotMatch(raw, /originalText|candidateChunks|focusItems|scenePlan/);
    await publishSavedJob(fresh, document.id, { publish: async () => join(root, document.id + ".json") });
    await assert.rejects(backupSavedJob(fresh, document.id, async () => { throw new Error("Offline"); }), /Offline/);
    assert.equal((await fresh.jobs.getRecord(document.id))?.summary.backup?.status, "failed");
    await backupSavedJob(fresh, document.id, async () => "https://drive.google.com/file/d/saved/view");
    assert.equal((await fresh.jobs.listRecords())[0]?.backup?.status, "backed-up");
    assert.deepEqual(await fresh.jobs.list(), []);
    assert.deepEqual(await fresh.documents.get(document.id), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
