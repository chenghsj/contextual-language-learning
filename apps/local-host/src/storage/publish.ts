import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readLearningDocument, type Destination, type LearningDocument } from "@immersive/core";
import { toMarkdown } from "../generation/markdown";
import { validateFolder } from "./folders";
import type { DocumentPublisher, StoragePorts } from "./ports";

async function writeOnce(path: string, content: string, documentId: string): Promise<void> {
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
    // A previous upload/export may have completed before the Host crashed. Never replace another document.
    if (!path.endsWith(".json")) return;
    const existing = readLearningDocument(JSON.parse(await readFile(path, "utf8")) as unknown);
    if (existing.id !== documentId) throw new Error("Local destination already contains a different document");
  }
}

export class DestinationPublisher implements DocumentPublisher {
  async publish(document: LearningDocument, markdown: string, destination: Destination): Promise<string> {
    if (destination.kind === "drive") throw new Error("Google Drive is a backup, not a primary destination");
    const folder = await validateFolder(destination.directory);
    const jsonPath = join(folder, document.id + ".json");
    const markdownPath = join(folder, document.id + ".md");
    await writeOnce(jsonPath, JSON.stringify(document, null, 2) + "\n", document.id);
    await writeOnce(markdownPath, markdown, document.id);
    return jsonPath;
  }
}

/** Update only an app-published local copy, never an unrelated or user-edited file.
 * The repository copy was already saved on explicit Done. */
export async function syncPublishedPlayback(
  storage: StoragePorts, previous: LearningDocument, updated: LearningDocument,
): Promise<void> {
  if (previous.id !== updated.id || previous.schemaVersion !== 3 || updated.schemaVersion !== 3) {
    throw new Error("Playback sync requires the same saved V3 document");
  }
  const job = await storage.jobs.get(updated.id);
  if (!job || job.summary.publication?.status !== "published" ||
      !job.summary.publication.location) return;
  const folder = await validateFolder(job.request.destination?.kind === "local"
    ? job.request.destination.directory : undefined);
  const jsonPath = join(folder, updated.id + ".json");
  const mdPath = join(folder, updated.id + ".md");
  if (job.summary.publication.location !== jsonPath) {
    throw new Error("Published lesson destination no longer matches the verified local folder");
  }
  const oldJson = JSON.stringify(previous, null, 2) + "\n";
  const newJson = JSON.stringify(updated, null, 2) + "\n";
  const oldMd = toMarkdown(previous);
  const newMd = toMarkdown(updated);
  const currentJson = await readFile(jsonPath, "utf8");
  if (currentJson !== oldJson && currentJson !== newJson) {
    throw new Error("Published lesson was changed independently; local export was left untouched");
  }
  const currentMd = await readFile(mdPath, "utf8");
  if (currentMd !== oldMd && currentMd !== newMd) {
    throw new Error("Published Markdown was changed independently; local export was left untouched");
  }
  const writeIfChanged = async (path: string, current: string, next: string): Promise<void> => {
    if (current === next) return;
    const temporary = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, next, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  };
  await writeIfChanged(jsonPath, currentJson, newJson);
  await writeIfChanged(mdPath, currentMd, newMd);
}

export async function publishSavedJob(
  storage: StoragePorts, jobId: string, publisher: DocumentPublisher = new DestinationPublisher(),
): Promise<string> {
  const job = await storage.jobs.get(jobId);
  if (!job || job.summary.status !== "completed") throw new Error("A complete document is required before publishing");
  if (job.summary.publication?.status === "published" && job.summary.publication.location) {
    return job.summary.publication.location;
  }
  const document = await storage.documents.get(job.summary.documentId ?? jobId);
  if (!document) throw new Error("Saved learning document not found");
  const destination: Destination = job.request.destination?.kind === "local"
    ? job.request.destination : { kind: "local" };
  await storage.jobs.update(jobId, current => ({
    ...current, summary: { ...current.summary,
      publication: { status: "pending" }, updatedAt: new Date().toISOString() },
  }));
  try {
    const location = await publisher.publish(document, toMarkdown(document), destination);
    await storage.jobs.update(jobId, current => ({
      ...current, summary: { ...current.summary,
        publication: { status: "published", location },
        ...(current.request.backup?.enabled && !current.summary.backup ? {
          backup: { status: "pending" as const, accountId: current.request.backup.accountId!, updatedAt: new Date().toISOString() },
        } : {}),
        updatedAt: new Date().toISOString() },
    }));
    return location;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown publishing error";
    await storage.jobs.update(jobId, current => ({
      ...current, summary: { ...current.summary,
        publication: { status: "failed", error: message.slice(0, 500) }, updatedAt: new Date().toISOString() },
    }));
    throw error;
  }
}
