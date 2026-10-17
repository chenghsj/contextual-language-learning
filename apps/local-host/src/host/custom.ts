import { customDuplicateKey } from "../custom-duplicates";
import { sourceKey } from "../duplicates";
import type { GenerationQueue } from "../jobs/queue";
import { findCustomDriveDuplicates } from "../drive/api";
import { randomUUID } from "node:crypto";
import {
  type HostRequest,
  type HostMessage,
  type CustomDocument,
  type CustomGenerationRequest,
} from "@contextual/core";
import { CustomJobManager } from "../jobs/custom-manager";
import { customFingerprint } from "../generation/custom-pipeline";
import { contentHash, type CustomRepository } from "../storage/custom";

export function deliverCustom(
  reply: (message: HostMessage) => void,
  id: string,
  resource: "document" | "job",
  resourceId: string,
  value: unknown,
) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  const size = 192 * 1024,
    total = Math.ceil(bytes.length / size);
  if (total > 100) throw new Error("Custom result exceeds transport limit");
  for (let index = 0; index < total; index++)
    reply({
      id,
      type: "customChunk",
      resource,
      resourceId,
      index,
      total,
      dataBase64: bytes.subarray(index * size, (index + 1) * size).toString("base64"),
    });
}
export function createCustomHandler(
  repository: CustomRepository,
  manager: CustomJobManager,
  reply: (message: HostMessage) => void,
  afterSave?: (document: CustomDocument, id: string) => Promise<void>,
  findRemote = findCustomDriveDuplicates,
  queue?: GenerationQueue,
) {
  const checks = new Map<string, { fingerprint: string; ids: Set<string>; expires: number }>();
  async function duplicates(request: CustomGenerationRequest) {
    const fingerprint = customDuplicateKey(request);
    const local = (await repository.listDocuments())
      .filter(doc => customDuplicateKey(doc.request) === fingerprint)
      .map(doc => ({
        documentId: doc.id,
        title: doc.title,
        createdAt: doc.createdAt,
        local: true,
        destination: "local",
        exactSettings: true,
      }));
    for (const job of await repository.listJobs()) {
      if (
        job.summary.status === "cancelled" ||
        local.some(doc => doc.documentId === job.summary.id) ||
        customDuplicateKey(job.request) !== fingerprint
      )
        continue;
      local.push({
        documentId: job.summary.id,
        title: job.request.source.title,
        createdAt: job.summary.createdAt,
        local: false,
        destination: "local",
        exactSettings: true,
      });
    }
    const remote =
      request.backup?.enabled && request.backup.accountId
        ? await findRemote(request.backup.accountId, fingerprint, customFingerprint(request))
        : [];
    return [
      ...local,
      ...remote.filter(item => !local.some(doc => doc.documentId === item.documentId)),
    ];
  }
  async function finish(id: string, document: CustomDocument) {
    deliverCustom(reply, id, "document", document.id, document);
    try {
      await afterSave?.(document, id);
    } finally {
      reply({ id, type: "generationSettled" });
    }
  }
  return async (request: HostRequest): Promise<boolean> => {
    switch (request.type) {
      case "checkCustomDuplicates": {
        const matches = await duplicates(request.payload),
          token = randomUUID();
        checks.set(token, {
          fingerprint: contentHash(JSON.stringify(request.payload)),
          ids: new Set(matches.map(doc => doc.documentId)),
          expires: Date.now() + 600000,
        });
        reply({ id: request.id, type: "duplicates", token, matches });
        return true;
      }
      case "generateCustom": {
        const admit = async () => {
          if (request.id !== request.payload.id) throw new Error("Custom generation IDs differ");
          const checked = checks.get(request.checkToken);
          if (
            !checked ||
            checked.expires < Date.now() ||
            checked.fingerprint !== contentHash(JSON.stringify(request.payload))
          )
            throw new Error("Check duplicates again after changing custom generation settings");
          const matches = await duplicates(request.payload);
          if (matches.some(doc => !checked.ids.has(doc.documentId)))
            throw new Error("New duplicate content appeared; check again");
          if (matches.length && !request.confirmRegeneration)
            throw new Error("Confirm creation of a new content version");
          checks.delete(request.checkToken);
        };
        if (queue) {
          const queued = await queue.submit(
            request.payload.id,
            async () => {
              await admit();
              await manager.prepare(request.id, request.payload);
            },
            async () => {
              const job = await repository.getJob(request.payload.id);
              if (job?.summary.status === "cancelled")
                throw new DOMException("This operation was aborted.", "AbortError");
              await finish(request.id, await manager.resume(request.id, request.payload.id));
            },
          );
          await queued.completion.catch(async error => {
            await manager.queueFailed(request.id, request.payload.id, error);
            throw error;
          });
          return true;
        }
        await admit();
        await finish(request.id, await manager.start(request.id, request.payload));
        return true;
      }
      case "resumeCustom": {
        if (queue) {
          const queued = await queue.submit(
            request.jobId,
            async () => {
              await manager.enqueueResume(request.id, request.jobId);
            },
            async () => {
              await finish(request.id, await manager.resume(request.id, request.jobId));
            },
          );
          await queued.completion.catch(async error => {
            await manager.queueFailed(request.id, request.jobId, error);
            throw error;
          });
        } else await finish(request.id, await manager.resume(request.id, request.jobId));
        return true;
      }
      case "cancelCustom": {
        queue?.cancel(request.jobId);
        if (!(await manager.cancel(request.jobId)))
          throw new Error("Custom job is not cancellable");
        const job = await repository.getJob(request.jobId);
        if (job) reply({ id: request.id, type: "job", job: job.summary });
        reply({ id: request.id, type: "cancelled" });
        return true;
      }
      case "listCustomDocuments": {
        const jobs = await repository.listJobs(),
          byId = new Map(jobs.map(job => [job.summary.id, job.summary]));
        reply({
          id: request.id,
          type: "customDocuments",
          documents: (await repository.listDocuments()).slice(0, 500).map(doc => ({
            kind: "custom",
            documentId: doc.id,
            title: doc.title,
            createdAt: doc.createdAt,
            sourceTitle: doc.request.source.title,
            sourceKey: sourceKey(doc.request.source, doc.request.cues),
            backup: byId.get(doc.id)?.backup,
          })),
        });
        return true;
      }
      case "getCustomDocument": {
        const doc = await repository.getDocument(request.documentId);
        if (!doc) throw new Error("Custom document not found");
        deliverCustom(reply, request.id, "document", doc.id, doc);
        return true;
      }
      case "getCustomJob": {
        const job = await repository.getJob(request.jobId);
        if (!job) throw new Error("Custom job not found");
        deliverCustom(reply, request.id, "job", job.summary.id, job);
        return true;
      }
      case "renameCustomDocument":
        await repository.renameDocument(request.documentId, request.title);
        reply({ id: request.id, type: "customDocumentChanged", documentId: request.documentId });
        return true;
      case "deleteCustomDocument":
        await repository.deleteDocument(request.documentId);
        reply({ id: request.id, type: "customDocumentChanged", documentId: request.documentId });
        return true;
      default:
        return false;
    }
  };
}
