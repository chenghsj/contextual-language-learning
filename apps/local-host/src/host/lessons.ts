import type { HostRequest, LearningDocument } from "@immersive/core";
import { sourceKey } from "../duplicates";
import { publishDriveDocument } from "../drive/api";
import { toMarkdown } from "../generation/markdown";
import { syncPublishedPlayback } from "../storage/publish";
import { backupSavedJob } from "../storage/backup";
import type { HostDispatcherDeps } from "./context";

/** Library reads and calibrated playback updates operate on V4 canonical documents. */
export async function handleLessonRequest(request: HostRequest,
  { storage, manager, reply }: Pick<HostDispatcherDeps, "storage" | "manager" | "reply">,
  deliverDocument: (id: string, document: LearningDocument) => void): Promise<boolean> {
  switch (request.type) {
      case "listEndedJobs": {
        const jobs = await storage.jobs.list(Number.MAX_SAFE_INTEGER);
        reply({ id: request.id, type: "jobs", jobs: jobs.filter(job => ["completed", "failed", "cancelled"].includes(job.status)) });
        return true;
      }
      case "deleteJobHistory": {
        const deleted: string[] = [];
        const failed: { jobId: string; message: string }[] = [];
        for (const jobId of new Set(request.jobIds)) {
          try { await storage.jobs.deleteHistory(jobId); deleted.push(jobId); }
          catch (error) { failed.push({ jobId, message: error instanceof Error ? error.message : String(error) }); }
        }
        reply({ id: request.id, type: "jobHistoryDeleted", deleted, failed });
        return true;
      }
      case "listJobs":
        reply({ id: request.id, type: "jobs", jobs: await manager.list() });
        return true;
      case "listLessons": {
        const [documents, summaries] = await Promise.all([
          storage.documents.list(500), storage.jobs.listRecords(),
        ]);
        const byId = new Map(summaries.map(summary => [summary.documentId, summary]));
        reply({ id: request.id, type: "lessons", lessons: documents.map(doc => ({
          documentId: doc.id, title: doc.source.title, createdAt: doc.createdAt,
          sourceKey: sourceKey(doc.source, doc.cues),
          targetLanguage: doc.profile.targetLanguage, level: doc.profile.level,
          sceneCount: doc.sections.length, expressionCount: doc.sections.reduce((count, scene) => count + scene.focusItems.length, 0),
          sceneIds: doc.sections.map(scene => scene.id),
          ...(byId.get(doc.id)?.backup ? { backup: byId.get(doc.id)!.backup } : {}),
        })) });
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
        const previous = await storage.documents.get(request.documentId);
        if (!previous) throw new Error("Saved V4 document not found");
        const updated = request.type === "savePlaybackRange"
          ? await storage.documents.updatePlaybackRange(request.documentId, request.cueId, request.range)
          : await storage.documents.updateScenePlaybackRange(request.documentId, request.sceneId, request.range);
        const warnings: string[] = [];
        try {
          await syncPublishedPlayback(storage, previous, updated);
        } catch (error) {
          warnings.push("已儲存本地教材，但發布資料夾同步失敗：" +
            (error instanceof Error ? error.message : "Unknown local publishing error"));
        }
        // The backup files are app-owned and immutable for unrelated edits.
        // A prior matching canonical document authorizes ONLY this calibration revision.
        const job = await storage.jobs.getRecord(updated.id);
        if (job?.summary.backup?.status === "backed-up" && job.summary.backup.accountId) {
          try {
            if (JSON.stringify(previous) !== JSON.stringify(updated)) {
              const location = await publishDriveDocument(
                job.summary.backup.accountId, updated, toMarkdown(updated), previous);
              await storage.jobs.updateRecord(updated.id, current => ({
                ...current, summary: { ...current.summary,
                  backup: { status: "backed-up", accountId: job.summary.backup!.accountId,
                    location, updatedAt: new Date().toISOString() },
                  updatedAt: new Date().toISOString() },
              }));
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown Drive backup error";
            warnings.push("Google Drive 尚未同步校正資料：" + message);
            await storage.jobs.updateRecord(updated.id, current => ({
              ...current, summary: { ...current.summary,
                backup: { status: "failed", accountId: job.summary.backup!.accountId,
                  error: message.slice(0, 500), updatedAt: new Date().toISOString() },
                updatedAt: new Date().toISOString() },
            }));
          }
        } else if (job?.request.backup?.enabled && job.summary.backup?.status !== "backed-up") {
          // A new/pending backup reads the just-saved canonical document.
          try { await backupSavedJob(storage, updated.id); }
          catch (error) {
            warnings.push("Google Drive 尚未同步校正資料：" +
              (error instanceof Error ? error.message : "Unknown backup error"));
          }
        }
        if (request.type === "savePlaybackRange") {
          reply({ id: request.id, type: "playbackRangeSaved",
            cueId: request.cueId, range: updated.playbackOverrides?.[request.cueId] ?? null,
            ...(warnings.length ? { warning: warnings.join("；") } : {}) });
        } else {
          reply({ id: request.id, type: "scenePlaybackRangeSaved",
            sceneId: request.sceneId, range: updated.scenePlaybackOverrides?.[request.sceneId] ?? null,
            ...(warnings.length ? { warning: warnings.join("；") } : {}) });
        }
        return true;
      }
    default: return false;
  }
}
