import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLearningCues } from "./subtitles";
import { LearningDocumentV7Schema, GenerationRequestSchema } from "./schema";
import { createSceneJob, JobSnapshotSchema } from "./jobs";

test("overlapping duplicate caption updates do not become separate learning lines", () => {
  const cues = [
    { id: "cue-1", startMs: 1000, endMs: 2000, originalText: "Hello!" },
    { id: "cue-2", startMs: 1100, endMs: 2100, originalText: "Hello!" },
    { id: "cue-3", startMs: 3200, endMs: 4100, originalText: "Hello!" },
    { id: "cue-4", startMs: 4200, endMs: 5000, originalText: "♪～" },
  ];
  const normalized = normalizeLearningCues(cues);
  assert.deepEqual(
    normalized.map(cue => cue.id),
    ["cue-1", "cue-3"],
  );
  assert.equal(normalized[0].endMs, 2100);
  assert.equal(cues[0].endMs, 2000, "canonical cues must not change");
});

test("a scene job tracks curation checkpoints separately from sections", () => {
  const request = GenerationRequestSchema.parse({
    outputSchemaVersion: 7,
    id: "11111111-1111-4111-8111-111111111111",
    source: { platform: "youtube", title: "Example" },
    profile: {
      targetLanguage: "en",
      instructionLanguage: "zh-TW",
      level: "B1",
      sceneCount: 2,
      contextualExampleCount: 2,
    },
    agent: { provider: "anthropic", modelId: "" },
    cues: [{ id: "cue-1", startMs: 0, endMs: 2000, originalText: "Hello." }],
  });
  const job = createSceneJob(request, 1);
  assert.equal(job.summary.total, 4, "one discovery + one selection + two possible scenes");
  assert.ok(job.learningPlan);
  assert.equal(
    JobSnapshotSchema.safeParse({ ...job, summary: { ...job.summary, completed: 1 } }).success,
    false,
  );
  assert.equal(LearningDocumentV7Schema.safeParse({ schemaVersion: 3 }).success, false);
});
