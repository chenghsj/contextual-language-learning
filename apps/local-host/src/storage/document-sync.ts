import {
  LearningDocumentSchema,
  type LearningDocument,
  type PlaybackOverride,
} from "@immersive/core";
import { toMarkdown } from "../generation/markdown";
import type { StoragePorts, DocumentPublisher } from "./ports";
import { publishSavedJob, publishRevision } from "./publish";
import { backupSavedJob, backupRevision, type BackupPublisher } from "./backup";
import { serializeDocument, documentRevision } from "./document-queue";

/** Serialize complete operations, including network work, per lesson in this Host process. */
export function createDocumentSync(
  storage: StoragePorts,
  adapters: { publisher?: DocumentPublisher; backup?: BackupPublisher } = {},
) {
  return {
    publish: (id: string) => publishSavedJob(storage, id, adapters.publisher),
    backup: (id: string) => backupSavedJob(storage, id, adapters.backup),
    saveCalibration: (
      id: string,
      target: { kind: "cue" | "scene"; id: string },
      range: PlaybackOverride | null,
    ) =>
      serializeDocument(storage, id, async () => {
        // Read current bytes only after entering the queue; never join an upload of an older document.
        const document =
          target.kind === "cue"
            ? await storage.documents.updatePlaybackRange(id, target.id, range)
            : await storage.documents.updateScenePlaybackRange(id, target.id, range);
        const warnings: string[] = [];
        const record = await storage.jobs.getRecord(id);
        if (record) {
          try {
            await publishRevision(storage, id, adapters.publisher);
          } catch (error) {
            warnings.push("已儲存本地教材，但發布資料夾同步失敗：" + String(error));
          }
          if (record.request.backup?.enabled) {
            try {
              await backupRevision(storage, id, adapters.backup);
            } catch (error) {
              warnings.push("Google Drive 尚未同步校正資料：" + String(error));
            }
          }
        }
        return { document, warning: warnings.length ? warnings.join("；") : undefined };
      }),
    setBackupAccount: (id: string, accountId: string) =>
      serializeDocument(storage, id, async () => {
        const record = await storage.jobs.getRecord(id);
        if (
          !record ||
          record.summary.status !== "completed" ||
          !record.summary.documentId ||
          record.summary.publication?.status !== "published"
        )
          return false;
        const document = await storage.documents.get(record.summary.documentId);
        if (
          document &&
          record.summary.backup?.status === "backed-up" &&
          record.summary.backup.accountId === accountId &&
          record.summary.backup.revision === documentRevision(document)
        )
          return false;
        await storage.jobs.updateRecord(id, current => ({
          ...current,
          request: { ...current.request, backup: { enabled: true, accountId } },
          summary: {
            ...current.summary,
            backup: { status: "pending", accountId, updatedAt: new Date().toISOString() },
          },
        }));
        return true;
      }),
    deleteHistory: (id: string) =>
      serializeDocument(storage, id, () => storage.jobs.deleteHistory(id)),
    restore: (id: string, load: () => Promise<LearningDocument>) =>
      serializeDocument(storage, id, async () => {
        const document = LearningDocumentSchema.parse(await load());
        if (document.id !== id) throw new Error("Restored lesson identity mismatch");
        const existing = await storage.documents.get(document.id);
        if (existing && documentRevision(existing) !== documentRevision(document))
          throw new Error("本地已有不同版本的相同教材，請先處理衝突");
        if (!existing) await storage.documents.save(document, toMarkdown(document));
      }),
  };
}
