import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSceneJob, GenerationRequestSchema, type HostMessage } from "@contextual/core";
import { localStoragePorts } from "./file";
import { handleLessonRequest } from "../host/lessons";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { JobManager } from "../jobs/manager";

test("batch history clearing includes records beyond the latest 50, reports failures, and rechecks status", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-clear-history-"));
  try {
    const storage = localStoragePorts(root);
    const ids: string[] = [];
    for (let i = 0; i < 61; i++) {
      const id = randomUUID();
      ids.push(id);
      const job = createSceneJob(
        GenerationRequestSchema.parse({
          id,
          outputSchemaVersion: 7,
          source: { platform: "import", title: "History " + i },
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
      job.execution = pointsFixture().document.execution;
      job.summary.execution = job.execution;
      job.summary.status = i === 60 ? "running" : "failed";
      await storage.jobs.create(job);
    }
    const replies: HostMessage[] = [];
    const deps = {
      storage,
      manager: new JobManager({ storage }, () => undefined),
      reply: (message: HostMessage) => replies.push(message),
    };
    await handleLessonRequest({ id: randomUUID(), type: "listEndedJobs" }, deps, () => undefined);
    const preview = replies.pop()!;
    assert.equal(preview.type, "jobs");
    if (preview.type !== "jobs") throw new Error("Unexpected response");
    assert.equal(preview.jobs.length, 60);
    assert.ok(!preview.jobs.some(job => job.id === ids[60]));
    // A job resumed after opening confirmation must survive deletion.
    await storage.jobs.update(ids[0], job => ({
      ...job,
      summary: { ...job.summary, status: "running" },
    }));
    await handleLessonRequest(
      { id: randomUUID(), type: "deleteJobHistory", jobIds: [...ids, ids[1]] },
      deps,
      () => undefined,
    );
    const result = replies.pop()!;
    assert.equal(result.type, "jobHistoryDeleted");
    if (result.type !== "jobHistoryDeleted") throw new Error("Unexpected response");
    assert.equal(result.deleted.length, 59);
    assert.deepEqual(
      result.failed.map(item => item.jobId),
      [ids[0], ids[60]],
    );
    assert.equal((await storage.jobs.get(ids[0]))?.summary.status, "running");
    assert.equal((await storage.jobs.list()).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
