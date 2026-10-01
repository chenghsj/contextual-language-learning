import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { GenerationRequestSchema } from "./schema";
import {
  createSceneJob,
  JobSnapshotSchema,
  JobStatusSchema,
  readLearningDocument,
  transitionJob,
} from "./jobs";

function request() {
  return GenerationRequestSchema.parse({
    id: randomUUID(),
    source: { platform: "import", title: "A lesson" },
    profile: {
      targetLanguage: "en",
      instructionLanguage: "zh-TW",
      level: "B1",
      sceneCount: 2,
      contextualExampleCount: 2,
    },
    agent: { provider: "openai", modelId: "" },
    cues: [{ id: "cue-1", startMs: 1000, endMs: 2000, originalText: "Good morning." }],
  });
}

test("state machine permits only legal transitions", () => {
  const job = createSceneJob(request(), 1);
  assert.equal(job.summary.status, "queued");
  const running = transitionJob(job, "running");
  const waiting = transitionJob(running, "waiting");
  const queued = transitionJob(waiting, "queued");
  assert.equal(transitionJob(queued, "cancelled").summary.status, "cancelled");
  assert.throws(() => transitionJob(job, "completed"), /Invalid job transition/);
  assert.throws(
    () => transitionJob(transitionJob(job, "cancelled"), "running"),
    /Invalid job transition/,
  );
  assert.equal(JobStatusSchema.safeParse("done").success, false);
});

test("checkpoints must agree with completed count and document versions are explicit", () => {
  const job = createSceneJob(request(), 1);
  assert.equal(
    JobSnapshotSchema.safeParse({ ...job, summary: { ...job.summary, completed: 1 } }).success,
    false,
  );
  assert.throws(() => readLearningDocument({ schemaVersion: 99 }), /Unsupported/);
});
