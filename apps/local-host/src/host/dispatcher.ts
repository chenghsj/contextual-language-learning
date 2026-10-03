import { accessTokenFor } from "../drive/oauth";
import { createCustomPublication } from "../storage/custom-backup";
import { getCustomDriveDocument, listCustomDriveDocuments } from "../drive/api";
import { FileCustomRepository } from "../storage/custom";
import { CustomJobManager } from "../jobs/custom-manager";
import { createCustomHandler } from "./custom";
import { createGenerationHandler } from "./generation";
import { handleLessonRequest } from "./lessons";
import { handleDriveRequest } from "./drive";
import { createPublicationFlow } from "./publication";
import { handleAgentRequest } from "./agents";
import { HostRequestSchema } from "@immersive/core";
import type { HostDispatcherDeps } from "./context";

/** Dispatch validated requests with caller-owned storage, job lifecycle and transport. */
export function createHostDispatcher({
  storage,
  manager,
  reply,
  hostVersion,
  customManager,
}: HostDispatcherDeps) {
  const {
    deliverDocument,
    finishDocument,
    handle: handlePublication,
  } = createPublicationFlow(storage, reply);
  const custom =
    customManager ??
    new CustomJobManager(
      { repository: new FileCustomRepository() },
      (id, job) => reply({ id, type: "job", job }),
      () => manager.isRunning(),
    );
  manager.setExternalBusyGuard(() => custom.isRunning());
  const customPublication = createCustomPublication(custom.deps.repository, reply);
  const handleCustom = createCustomHandler(
    custom.deps.repository,
    custom,
    reply,
    customPublication.afterSave,
  );
  const handleGeneration = createGenerationHandler({ storage, manager, reply }, finishDocument);

  async function handle(input: unknown): Promise<void> {
    const parsed = HostRequestSchema.safeParse(input);
    if (!parsed.success) {
      const maybeId =
        input && typeof input === "object" && "id" in input && typeof input.id === "string"
          ? input.id
          : "invalid-request";
      reply({
        id: maybeId,
        type: "error",
        message: "Invalid request: " + parsed.error.issues[0]?.message,
      });
      return;
    }
    const request = parsed.data;
    let customBackupCount = 0;
    try {
      if (request.type === "getJobExecution") {
        const job = await custom.deps.repository.getJob(request.jobId);
        const standard = job ? null : await storage.jobs.get(request.jobId);
        const doc = !job && !standard ? await storage.documents.get(request.jobId) : null;
        reply({
          id: request.id,
          type: "jobExecution",
          execution: job?.execution ?? standard?.execution ?? doc?.execution ?? null,
        });
        return;
      }
      if (await handleCustom(request)) return;
      if (request.type === "listCustomDriveDocuments") {
        reply({
          id: request.id,
          type: "customDriveDocuments",
          documents: (await listCustomDriveDocuments(request.accountId)).slice(0, 500),
        });
        return;
      }
      if (request.type === "restoreCustomDriveDocument") {
        await custom.deps.repository.saveDocument(
          await getCustomDriveDocument(request.accountId, request.documentId),
        );
        reply({ id: request.id, type: "customDocumentChanged", documentId: request.documentId });
        return;
      }
      if (request.type === "retryBackup" && (await custom.deps.repository.getJob(request.jobId))) {
        await customPublication.backup(request.jobId, request.id);
        return;
      }
      if (request.type === "publishJob" && (await custom.deps.repository.getJob(request.jobId))) {
        const doc = await custom.deps.repository.getDocument(request.jobId);
        if (!doc) throw new Error("Custom document not found");
        await customPublication.localCopy(doc, request.id);
        return;
      }
      if (request.type === "backupExisting") {
        await accessTokenFor(request.accountId);
        customBackupCount = await customPublication.schedule(request.accountId);
      }
      if (request.type === "resumeBackups") await customPublication.resume(request.id);

      if (request.type === "listJobs" || request.type === "listEndedJobs") {
        const jobs = [...(await manager.list()), ...(await custom.list())].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        );
        reply({
          id: request.id,
          type: "jobs",
          jobs: (request.type === "listEndedJobs"
            ? jobs.filter(job => ["completed", "failed", "cancelled"].includes(job.status))
            : jobs
          ).slice(0, 50),
        });
        return;
      }
      if (request.type === "deleteJobHistory") {
        for (const id of request.jobIds) {
          const job = await custom.deps.repository.getJob(id);
          if (job) {
            if (["running", "queued"].includes(job.summary.status))
              throw new Error("Cannot clear an active custom job");
            await custom.deps.repository.updateJob(id, current => ({
              ...current,
              historyHidden: true,
            }));
          }
        }
        const standardIds: string[] = [];
        for (const id of request.jobIds)
          if (!(await custom.deps.repository.getJob(id))) standardIds.push(id);
        const customIds = request.jobIds.filter(id => !standardIds.includes(id));
        if (!standardIds.length) {
          reply({ id: request.id, type: "jobHistoryDeleted", deleted: customIds, failed: [] });
          return;
        }
        // Handle each kind through its own repository; merge the standard reply with cleared custom ids.
        await handleLessonRequest(
          { ...request, jobIds: standardIds },
          {
            storage,
            manager,
            reply: message =>
              reply(
                message.type === "jobHistoryDeleted"
                  ? { ...message, deleted: [...message.deleted, ...customIds] }
                  : message,
              ),
          },
          deliverDocument,
        );
        return;
      }
      if (await handleAgentRequest(request, { storage, manager, reply, hostVersion })) return;
      if (
        await handleDriveRequest(request, {
          storage,
          reply: message =>
            reply(
              message.type === "backupsScheduled"
                ? { ...message, count: message.count + customBackupCount }
                : message,
            ),
        })
      )
        return;
      if (await handleLessonRequest(request, { storage, manager, reply }, deliverDocument)) return;
      if (await handleGeneration(request)) return;
      if (await handlePublication(request)) return;
      reply({ id: request.id, type: "error", message: "Unsupported Native Host request." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Host error";
      reply({ id: request.id, type: "error", message: message.slice(0, 1200) });
    }
  }

  return handle;
}
