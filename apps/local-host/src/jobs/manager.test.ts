import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, createJob, type JobSummary } from "@immersive/core";
import { JobManager } from "./manager";
import { localStoragePorts } from "../storage/file";

function request() {
  return GenerationRequestSchema.parse({
    id: randomUUID(),
    source: { platform: "import", title: "Resume lesson" },
    profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
      mode: "guided", maxNewVocabulary: 3, exerciseCount: 1 },
    agent: { provider: "custom-" + "a".repeat(24), modelId: "" },
    cues: [
      { id: "cue-1", startMs: 0, endMs: 2000, originalText: "Good morning!" },
      { id: "cue-2", startMs: 310_000, endMs: 312_000, originalText: "Nice to meet you." },
    ],
  });
}

const sample = {
  title: "An introduction", context: "Two people meet.",
  vocabulary: [], insights: [], exercises: [],
};

test("interruption retains validated checkpoints and resume does not regenerate them", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-test-"));
  try {
    const storage = localStoragePorts(root);
    const payload = request();
    let calls = 0;
    const abort = new AbortController();
    const reportedWaiting: JobSummary[] = [];
    const notify = (_id: string, summary: JobSummary) => {
      reportedWaiting.push(summary);
      if (summary.completed === 1 && summary.status === "running") abort.abort();
    };
    const first = new JobManager({
      storage,
      legacyGeneration: true,
      generateSection: async () => { calls++; return sample; },
    }, notify);
    await assert.rejects(first.start(payload.id, payload, abort.signal), /interrupt/);
    const waiting = await storage.jobs.get(payload.id);
    assert.equal(waiting?.summary.status, "waiting");
    assert.equal(reportedWaiting.at(-1)?.status, "waiting");
    assert.equal(waiting?.summary.completed, 1);
    assert.equal(waiting?.sections.length, 1);
    const previousSectionId = waiting!.sections[0].id;
    assert.equal(calls, 1);

    const second = new JobManager({
      storage,
      legacyGeneration: true,
      generateSection: async () => { calls++; return sample; },
    }, () => undefined);
    const document = await second.resume(randomUUID(), payload.id);
    assert.equal(calls, 2);
    assert.equal(document.id, payload.id);
    assert.equal(document.sections.length, 2);
    assert.equal(document.sections[0].id, previousSectionId);
    assert.equal((await storage.jobs.get(payload.id))?.summary.status, "completed");
    assert.equal((await storage.documents.get(payload.id))?.id, payload.id);
    await assert.rejects(second.resume(randomUUID(), payload.id), /cannot be resumed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed generation is restartable, cancellation is terminal", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-test-"));
  try {
    const storage = localStoragePorts(root);
    const payload = request();
    const reported: JobSummary[] = [];
    const manager = new JobManager({
      storage, legacyGeneration: true, generateSection: async () => { throw new Error("Agent temporarily unavailable"); },
    }, (_requestId, summary) => { reported.push(summary); });
    await assert.rejects(manager.start(payload.id, payload), /Agent temporarily unavailable/);
    assert.equal((await storage.jobs.get(payload.id))?.summary.status, "failed");
    assert.equal(reported.at(-1)?.status, "failed", "failure must be pushed to the Side Panel");
    assert.equal(reported.at(-1)?.completed, 0);
    assert.match(reported.at(-1)?.error ?? "", /temporarily unavailable/);
    assert.equal(await manager.cancel(payload.id), true);
    assert.equal((await storage.jobs.get(payload.id))?.summary.status, "cancelled");
    await assert.rejects(manager.resume(randomUUID(), payload.id), /cannot be resumed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("study progress is stored separately from the generated document", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-test-"));
  try {
    const storage = localStoragePorts(root);
    const documentId = randomUUID();
    const progress = {
      schemaVersion: 1 as const, documentId, completedSectionIds: [randomUUID()],
      reviewedExpressions: ["on the fence"], updatedAt: new Date().toISOString(),
    };
    await storage.progress.save(progress);
    assert.deepEqual(await storage.progress.get(documentId), progress);
    assert.equal(await storage.documents.get(documentId), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy built-in job history remains readable, but unfinished jobs cannot resume", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-legacy-jobs-"));
  try {
    const storage = localStoragePorts(root);
    const requestData = request();
    const legacy = { ...requestData, agent: { provider: "agy", modelId: "" } };
    const manager = new JobManager({ storage, legacyGeneration: true,
      generateSection: async () => sample }, () => undefined);
    await assert.rejects(manager.start(legacy.id, legacy), /no longer supported/);
    const saved = createJob(legacy, 2);
    await storage.jobs.create(saved);
    await assert.rejects(manager.resume(randomUUID(), saved.summary.id),
      /Import your own CLI Agent JSON and create a new lesson/);
    assert.equal((await storage.jobs.get(saved.summary.id))?.summary.status, "queued",
      "migration must not rewrite or silently cancel the historical checkpoint");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
