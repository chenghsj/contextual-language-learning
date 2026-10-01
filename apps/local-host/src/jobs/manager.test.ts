import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, type JobSummary } from "@immersive/core";
import { JobManager } from "./manager";
import { localStoragePorts } from "../storage/file";

function request() {
  return GenerationRequestSchema.parse({
    id: randomUUID(), source: { platform: "import", title: "Resume lesson" },
    profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
      sceneCount: 2, contextualExampleCount: 1 },
    agent: { provider: "openai", modelId: "" },
    cues: [
      { id: "cue-1", startMs: 0, endMs: 2000, originalText: "Good morning!" },
      { id: "cue-2", startMs: 3000, endMs: 5000, originalText: "Nice to meet you." },
    ],
  });
}

test("cancelled V4 generation retains its checkpoint and can resume", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-test-"));
  try {
    const storage = localStoragePorts(root);
    const payload = request();
    const reported: JobSummary[] = [];
    const manager = new JobManager({
      storage, generateCandidates: async () => { throw new Error("Agent temporarily unavailable"); },
    }, (_requestId, summary) => { reported.push(summary); });
    await assert.rejects(manager.start(payload.id, payload), /Agent temporarily unavailable/);
    assert.equal((await storage.jobs.get(payload.id))?.summary.status, "failed");
    assert.equal(reported.at(-1)?.status, "failed");
    assert.match(reported.at(-1)?.error ?? "", /temporarily unavailable/);
    assert.equal(await manager.cancel(payload.id), true);
    assert.equal((await storage.jobs.get(payload.id))?.summary.status, "cancelled");
    const checkpoint = await storage.jobs.get(payload.id);
    await assert.rejects(manager.resume(randomUUID(), payload.id), /Agent temporarily unavailable/);
    const resumed = await storage.jobs.get(payload.id);
    assert.equal(resumed?.summary.status, "failed");
    assert.deepEqual(resumed?.scenePlan, checkpoint?.scenePlan);
    assert.deepEqual(resumed?.sections, checkpoint?.sections);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
