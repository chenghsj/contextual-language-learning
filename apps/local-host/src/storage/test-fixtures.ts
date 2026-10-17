import { randomUUID, createHash } from "node:crypto";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { createSceneJob, learningDocumentToMarkdown } from "@contextual/core";
import { localStoragePorts } from "./file";
/** Current standard lesson; disk fixtures never require live model access. */
export async function completedLesson(root: string) {
  const f = pointsFixture();
  const id = randomUUID();
  f.request.id = id;
  f.document.id = id;
  f.request.backup = { enabled: true, accountId: "fake-account" };
  f.document.execution!.inputFingerprint = createHash("sha256")
    .update(JSON.stringify(f.request))
    .digest("hex");
  const job = createSceneJob(f.request, 1);
  job.execution = f.document.execution;
  job.summary = {
    ...job.summary,
    execution: job.execution,
    status: "completed",
    completed: 3,
    total: 3,
    documentId: id,
  };
  const scene = { ...f.input.scene, id: f.document.sections[0].id };
  job.learningPlan.candidateWindows[0].candidates = [scene];
  job.learningPlan.selected = [scene];
  job.learningPlan.batches = [
    {
      id: "s0",
      sceneId: scene.id,
      utteranceIds: scene.utterances.map(u => u.id),
      repairAttempted: false,
      result: f.result,
    },
  ];
  job.sections = f.document.sections;
  const storage = localStoragePorts(root);
  await storage.jobs.create(job);
  await storage.documents.save(f.document, learningDocumentToMarkdown(f.document));
  return { storage, document: f.document };
}
