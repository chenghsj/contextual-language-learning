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

test("publication failure preserves finished material; retry never regenerates", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-publication-"));
  try {
    const storage = localStoragePorts(root);
    const request = GenerationRequestSchema.parse({
      id: randomUUID(), source: { platform: "import", title: "Test" },
      profile: { targetLanguage: "en", instructionLanguage: "en",
        level: "A2", mode: "guided", maxNewVocabulary: 2, exerciseCount: 1 },
      agent: { provider: "claude", modelId: "" },
      destination: { kind: "drive", accountId: "fake-test-account" },
      cues: [{ id: "cue-1", startMs: null, endMs: null, originalText: "Hello" }],
    });
    let generated = 0;
    const manager = new JobManager({
      storage, generateSection: async () => {
        generated += 1;
        return { title: "Hello", context: "Context", vocabulary: [], insights: [], exercises: [] };
      },
    }, () => undefined);
    const document = await manager.start(request.id, request);
    assert.equal(generated, 1);
    await assert.rejects(publishSavedJob(storage, document.id, {
      publish: async () => { throw new Error("Drive offline"); },
    }), /Drive offline/);
    assert.equal((await storage.jobs.get(document.id))?.summary.status, "completed");
    assert.equal((await storage.jobs.get(document.id))?.summary.publication?.status, "failed");
    assert.equal((await storage.documents.get(document.id))?.id, document.id);
    const uri = await publishSavedJob(storage, document.id, {
      publish: async () => "https://drive.google.com/file/d/example/view",
    });
    assert.equal(uri, "https://drive.google.com/file/d/example/view");
    assert.equal((await storage.jobs.get(document.id))?.summary.publication?.status, "published");
    assert.equal(generated, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
