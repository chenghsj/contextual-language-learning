import type { CustomDocument, HostMessage } from "@immersive/core";
import { mkdir, readFile, open, link, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { publishCustomDriveDocument, DriveContentConflict } from "../drive/api";
import { validateFolder } from "./folders";
import { contentHash, type CustomRepository } from "./custom";

/** A per-document lock keeps retries from duplicating remote or local publication. */
export function createCustomPublication(
  repository: CustomRepository,
  reply: (message: HostMessage) => void,
  publish = publishCustomDriveDocument,
  resolveFolder = validateFolder,
) {
  const running = new Map<string, Promise<void>>();
  const queues = new Map<string, Promise<unknown>>();
  async function serialized<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = queues.get(id) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    queues.set(id, next);
    try {
      return await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }
  async function backup(id: string, requestId: string): Promise<void> {
    if (running.has(id)) return running.get(id);
    const work = serialized(id, async () => {
      const job = await repository.getJob(id),
        document = await repository.getDocument(id);
      if (!job || !document || !job.summary.backup)
        throw new Error("Custom backup needs a saved local document and selected account");
      const accountId = job.summary.backup.accountId;
      await repository.updateJob(id, current => ({
        ...current,
        summary: {
          ...current.summary,
          backup: {
            ...current.summary.backup!,
            status: "uploading",
            error: undefined,
            updatedAt: new Date().toISOString(),
          },
        },
      }));
      try {
        let location = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            location = await publish(accountId, document);
            break;
          } catch (error) {
            if (
              error instanceof DriveContentConflict ||
              attempt === 2 ||
              !/HTTP (?:429|5\d\d)/.test(String(error))
            )
              throw error;
            await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
          }
        }
        await repository.updateJob(id, current => ({
          ...current,
          summary: {
            ...current.summary,
            backup: {
              ...current.summary.backup!,
              status: "backed-up",
              location,
              revision: contentHash(JSON.stringify(document)),
              error: undefined,
              updatedAt: new Date().toISOString(),
            },
          },
        }));
        reply({ id: requestId, type: "backupPublished", jobId: id, location });
      } catch (error) {
        const message = String(error).slice(0, 1200);
        await repository.updateJob(id, current => ({
          ...current,
          summary: {
            ...current.summary,
            backup: {
              ...current.summary.backup!,
              status: error instanceof DriveContentConflict ? "conflict" : "failed",
              error: message,
              updatedAt: new Date().toISOString(),
            },
          },
        }));
        reply({ id: requestId, type: "backupFailed", jobId: id, message });
        throw error;
      }
    });
    running.set(id, work);
    try {
      await work;
    } finally {
      running.delete(id);
    }
  }
  async function localCopy(document: CustomDocument, requestId: string) {
    const destination = document.request.destination;
    if (destination?.kind !== "local" || !destination.directory) {
      await repository.updateJob(document.id, current => ({
        ...current,
        summary: {
          ...current.summary,
          publication: { status: "published", location: "custom-v1" },
        },
      }));
      reply({ id: requestId, type: "published", jobId: document.id, location: "custom-v1" });
      return;
    }
    try {
      const approvedDirectory = await resolveFolder(destination.directory);
      const folder = join(approvedDirectory, "Custom-" + document.id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const { markdown, ...metadata } = document;
      for (const [name, content] of [
        ["content.md", markdown],
        [
          "metadata.json",
          JSON.stringify({ ...metadata, markdownHash: contentHash(markdown) }, null, 2),
        ],
      ] as const) {
        const path = join(folder, name);
        try {
          const temporary = path + "." + randomUUID() + ".tmp";
          try {
            const file = await open(temporary, "wx", 0o600);
            try {
              await file.writeFile(content, "utf8");
              await file.sync();
            } finally {
              await file.close();
            }
            // An atomic link publishes a complete file without overwriting user files.
            await link(temporary, path);
          } finally {
            await rm(temporary, { force: true }).catch(() => {});
          }
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "EEXIST" ||
            (await readFile(path, "utf8")) !== content
          )
            throw new Error("Local copy conflicts with an existing file; original files preserved");
        }
      }
      await repository.updateJob(document.id, current => ({
        ...current,
        summary: { ...current.summary, publication: { status: "published", location: folder } },
      }));
      reply({ id: requestId, type: "published", jobId: document.id, location: folder });
    } catch (error) {
      const message = String(error);
      await repository.updateJob(document.id, current => ({
        ...current,
        summary: { ...current.summary, publication: { status: "failed", error: message } },
      }));
      reply({ id: requestId, type: "publicationFailed", jobId: document.id, message });
    }
  }
  async function afterSave(document: CustomDocument, requestId: string) {
    await localCopy(document, requestId);
    const job = await repository.getJob(document.id);
    if (job?.summary.backup) await backup(document.id, requestId).catch(() => {});
  }
  async function resume(requestId: string) {
    for (const job of await repository.listJobs())
      if (
        job.summary.status === "completed" &&
        ["pending", "uploading"].includes(job.summary.backup?.status ?? "")
      )
        await backup(job.summary.id, requestId).catch(() => {});
  }
  async function schedule(accountId: string) {
    let count = 0;
    for (const listed of await repository.listJobs()) {
      const added = await serialized(listed.summary.id, async () => {
        const job = await repository.getJob(listed.summary.id);
        const document = await repository.getDocument(listed.summary.id);
        if (!job || !document || job.summary.status !== "completed") return false;
        if (
          job.summary.backup?.status === "backed-up" &&
          job.summary.backup.accountId === accountId &&
          job.summary.backup.revision === contentHash(JSON.stringify(document))
        )
          return false;
        await repository.updateJob(job.summary.id, current => ({
          ...current,
          summary: {
            ...current.summary,
            backup: { status: "pending", accountId, updatedAt: new Date().toISOString() },
          },
        }));
        return true;
      });
      if (added) count++;
    }
    return count;
  }
  return { backup, localCopy, afterSave, resume, schedule };
}
