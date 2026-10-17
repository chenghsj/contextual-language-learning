import { setTimeout as delay } from "node:timers/promises";
import type { LearningDocument } from "@contextual/core";
import { publishDriveDocument, DriveContentConflict } from "../drive/api";
import { toMarkdown } from "../generation/markdown";
import type { StoragePorts } from "./ports";

export type BackupPublisher = (
  accountId: string,
  document: LearningDocument,
  markdown: string,
) => Promise<string>;
import { documentRevision, serializeDocument } from "./document-queue";

/** Independent of generation: a failed backup never invalidates a finished lesson. */
export async function backupRevision(
  storage: StoragePorts,
  jobId: string,
  publisher: BackupPublisher = publishDriveDocument,
): Promise<string | null> {
  const job = await storage.jobs.getRecord(jobId);
  if (!job || job.summary.status !== "completed") throw new Error("Completed lesson not found");
  const setting = job.request.backup;
  if (!setting?.enabled || !setting.accountId) return null;
  const document = await storage.documents.get(job.summary.documentId ?? jobId);
  if (!document) throw new Error("Local lesson is missing");
  const revision = documentRevision(document);
  if (
    job.summary.publication?.status !== "published" ||
    job.summary.publication.revision !== revision
  ) {
    const message = "Publish the latest lesson revision before backing it up";
    await storage.jobs.updateRecord(jobId, current => ({
      ...current,
      summary: {
        ...current.summary,
        backup: {
          status: "failed",
          accountId: setting.accountId!,
          error: message,
          updatedAt: new Date().toISOString(),
        },
      },
    }));
    throw new Error(message);
  }
  if (
    job.summary.backup?.status === "backed-up" &&
    job.summary.backup.location &&
    job.summary.backup.accountId === setting.accountId &&
    job.summary.backup.revision === revision
  )
    return job.summary.backup.location;
  await storage.jobs.updateRecord(jobId, current => ({
    ...current,
    summary: {
      ...current.summary,
      backup: {
        status: "uploading",
        accountId: setting.accountId!,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    },
  }));
  try {
    let location = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        location = await publisher(setting.accountId, document, toMarkdown(document));
        break;
      } catch (error) {
        if (
          error instanceof DriveContentConflict ||
          attempt === 2 ||
          !/(HTTP (429|500|502|503|504)|fetch failed|ETIMEDOUT|ECONNRESET)/i.test(String(error))
        )
          throw error;
        await delay(1000 * 2 ** attempt);
      }
    }
    await storage.jobs.updateRecord(jobId, current => ({
      ...current,
      summary: {
        ...current.summary,
        backup: {
          status: "backed-up",
          accountId: setting.accountId!,
          location,
          revision,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
    }));
    return location;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await storage.jobs.updateRecord(jobId, current => ({
      ...current,
      summary: {
        ...current.summary,
        backup: {
          status: error instanceof DriveContentConflict ? "conflict" : "failed",
          accountId: setting.accountId!,
          error: message.slice(0, 500),
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
    }));
    throw error;
  }
}

export function backupSavedJob(
  storage: StoragePorts,
  jobId: string,
  publisher?: BackupPublisher,
): Promise<string | null> {
  return serializeDocument(storage, jobId, () => backupRevision(storage, jobId, publisher));
}

/** Recover interrupted uploads after a Host restart; explicit failures need user action. */
export async function resumePendingBackups(
  storage: StoragePorts,
  publisher?: BackupPublisher,
): Promise<void> {
  const jobs = await storage.jobs.listRecords();
  for (const job of jobs) {
    if (
      job.status !== "completed" ||
      !job.backup ||
      !["pending", "uploading"].includes(job.backup.status)
    )
      continue;
    try {
      await backupSavedJob(storage, job.id, publisher);
    } catch {
      /* failed status is persisted */
    }
  }
}
