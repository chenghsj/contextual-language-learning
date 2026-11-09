import type { HostRequest, LearningDocument } from "@contextual/core";
import { sourceKey } from "../duplicates";
import { createDocumentSync } from "../storage/document-sync";
import type { HostDispatcherDeps } from "./context";

/** Library reads and calibrated playback updates operate on current canonical documents. */
export async function handleLessonRequest(
  request: HostRequest,
  { storage, manager, reply }: Pick<HostDispatcherDeps, "storage" | "manager" | "reply">,
  deliverDocument: (id: string, document: LearningDocument) => void,
): Promise<boolean> {
  switch (request.type) {
    case "deleteLocalLesson":
      await createDocumentSync(storage).deleteLocal(request.documentId);
      reply({ id: request.id, type: "localLessonDeleted", documentId: request.documentId });
      return true;
    case "listEndedJobs": {
      const jobs = await storage.jobs.list(Number.MAX_SAFE_INTEGER);
      reply({
        id: request.id,
        type: "jobs",
        jobs: jobs.filter(job => ["completed", "failed", "cancelled"].includes(job.status)),
      });
      return true;
    }
    case "deleteJobHistory": {
      const deleted: string[] = [];
      const failed: { jobId: string; message: string }[] = [];
      for (const jobId of new Set(request.jobIds)) {
        try {
          await createDocumentSync(storage).deleteHistory(jobId);
          deleted.push(jobId);
        } catch (error) {
          failed.push({ jobId, message: error instanceof Error ? error.message : String(error) });
        }
      }
      reply({ id: request.id, type: "jobHistoryDeleted", deleted, failed });
      return true;
    }
    case "listJobs":
      reply({ id: request.id, type: "jobs", jobs: await manager.list() });
      return true;
    case "listLessons": {
      const [documents, summaries] = await Promise.all([
        storage.documents.list(500),
        storage.jobs.listRecords(),
      ]);
      const byId = new Map(summaries.map(summary => [summary.documentId, summary]));
      reply({
        id: request.id,
        type: "lessons",
        lessons: documents.map(doc => ({
          documentId: doc.id,
          title: doc.source.title,
          createdAt: doc.createdAt,
          sourceKey: sourceKey(doc.source, doc.cues),
          targetLanguage: doc.profile.targetLanguage,
          level: doc.profile.level,
          sceneCount: doc.sections.length,
          schemaVersion: doc.schemaVersion,
          pointCount: doc.schemaVersion === 7 ? doc.points.length : undefined,
          reusableItemCount: doc.schemaVersion === 7 ? doc.reusableItems.length : undefined,
          sceneIds: doc.sections.map(scene => scene.id),
          ...(byId.get(doc.id)?.backup ? { backup: byId.get(doc.id)!.backup } : {}),
        })),
      });
      return true;
    }
    case "getDocument": {
      const document = await storage.documents.get(request.documentId);
      if (!document) throw new Error("Saved document not found");
      deliverDocument(request.id, document);
      return true;
    }
    case "savePlaybackRange":
    case "saveScenePlaybackRange": {
      const { document: updated, warning } = await createDocumentSync(storage).saveCalibration(
        request.documentId,
        {
          kind: request.type === "savePlaybackRange" ? "cue" : "scene",
          id: request.type === "savePlaybackRange" ? request.cueId : request.sceneId,
        },
        request.range,
      );
      if (request.type === "savePlaybackRange") {
        reply({
          id: request.id,
          type: "playbackRangeSaved",
          cueId: request.cueId,
          range: updated.playbackOverrides?.[request.cueId] ?? null,
          ...(warning ? { warning } : {}),
        });
      } else {
        reply({
          id: request.id,
          type: "scenePlaybackRangeSaved",
          sceneId: request.sceneId,
          range: updated.scenePlaybackOverrides?.[request.sceneId] ?? null,
          ...(warning ? { warning } : {}),
        });
      }
      return true;
    }
    default:
      return false;
  }
}
