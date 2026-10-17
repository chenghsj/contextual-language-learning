import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Destination, LearningDocument } from "@contextual/core";
import { toMarkdown } from "../generation/markdown";
import { validateFolder } from "./folders";
import type { DocumentPublisher, StoragePorts, PublicationJournal } from "./ports";
import { videoFolder } from "./video-folders";
import { contentHash, documentRevision, serializeDocument } from "./document-queue";

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
/** Prepare both files before writing either: unknown bytes are never overwritten. */
export class DestinationPublisher implements DocumentPublisher {
  constructor(
    private readonly folderFor: (directory: string | undefined) => Promise<string> = validateFolder,
  ) {}
  async publish(
    document: LearningDocument,
    markdown: string,
    destination: Destination,
    journal?: PublicationJournal,
  ): Promise<string> {
    if (destination.kind !== "local")
      throw new Error("Google Drive is a backup, not a primary destination");
    const folder = await videoFolder(await this.folderFor(destination.directory), document);
    const files = [
      {
        format: "json" as const,
        path: join(folder, document.id + ".json"),
        content: JSON.stringify(document, null, 2) + "\n",
      },
      { format: "markdown" as const, path: join(folder, document.id + ".md"), content: markdown },
    ];
    const originals = await Promise.all(files.map(file => readExisting(file.path)));
    for (const [index, file] of files.entries()) {
      const existing = originals[index];
      if (existing === null || existing === file.content) continue;
      const hash = contentHash(existing);
      if (!journal?.allowed.some(hashes => hashes[file.format] === hash)) {
        throw new Error(
          "Published lesson was changed independently; local export was left untouched",
        );
      }
    }
    for (const [index, file] of files.entries()) {
      if (originals[index] === file.content) continue;
      // Recheck external changes immediately before replacing. Cross-process transactions are out of scope.
      if ((await readExisting(file.path)) !== originals[index])
        throw new Error("Published lesson changed during synchronization");
      if (originals[index] === null) {
        await writeFile(file.path, file.content, { flag: "wx", mode: 0o600 });
        continue;
      }
      const tmp = file.path + "." + randomUUID() + ".tmp";
      try {
        await writeFile(tmp, file.content, { flag: "wx", mode: 0o600 });
        await rename(tmp, file.path);
      } finally {
        await rm(tmp, { force: true }).catch(() => {});
      }
    }
    return files[0].path;
  }
}

/** Called only inside the document queue. Persist planned hashes before writing any export bytes. */
export async function publishRevision(
  storage: StoragePorts,
  jobId: string,
  publisher: DocumentPublisher = new DestinationPublisher(),
): Promise<string> {
  const job = await storage.jobs.getRecord(jobId);
  if (!job || job.summary.status !== "completed")
    throw new Error("A complete document is required before publishing");
  const document = await storage.documents.get(job.summary.documentId ?? jobId);
  if (!document) throw new Error("Saved learning document not found");
  const markdown = toMarkdown(document);
  const revision = documentRevision(document);
  const hashes = {
    json: contentHash(JSON.stringify(document, null, 2) + "\n"),
    markdown: contentHash(markdown),
  };
  const prior = job.summary.publication;
  const allowed = [
    ...(prior?.authorizedHashes ?? []),
    prior?.attemptHashes,
    prior?.syncedHashes,
  ].filter((value): value is typeof hashes => !!value);
  const destination: Destination =
    job.request.destination?.kind === "local" ? job.request.destination : { kind: "local" };
  await storage.jobs.updateRecord(jobId, current => ({
    ...current,
    summary: {
      ...current.summary,
      publication: {
        ...prior,
        status: "pending",
        attemptHashes: hashes,
        authorizedHashes: [...allowed, hashes],
        error: undefined,
      },
      updatedAt: new Date().toISOString(),
    },
  }));
  try {
    const location = await publisher.publish(document, markdown, destination, { allowed });
    await storage.jobs.updateRecord(jobId, current => ({
      ...current,
      summary: {
        ...current.summary,
        publication: {
          status: "published",
          location,
          revision,
          attemptHashes: hashes,
          syncedHashes: hashes,
        },
        ...(current.request.backup?.enabled &&
        (!current.summary.backup ||
          current.summary.backup.revision !== revision ||
          current.summary.backup.accountId !== current.request.backup.accountId)
          ? {
              backup: {
                status: "pending" as const,
                accountId: current.request.backup.accountId!,
                updatedAt: new Date().toISOString(),
              },
            }
          : {}),
        updatedAt: new Date().toISOString(),
      },
    }));
    return location;
  } catch (error) {
    await storage.jobs.updateRecord(jobId, current => ({
      ...current,
      summary: {
        ...current.summary,
        publication: {
          ...current.summary.publication!,
          status: "failed",
          error: String(error).slice(0, 500),
        },
        updatedAt: new Date().toISOString(),
      },
    }));
    throw error;
  }
}
export function publishSavedJob(
  storage: StoragePorts,
  jobId: string,
  publisher?: DocumentPublisher,
): Promise<string> {
  return serializeDocument(storage, jobId, () => publishRevision(storage, jobId, publisher));
}
