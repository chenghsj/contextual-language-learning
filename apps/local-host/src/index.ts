import { randomUUID } from "node:crypto";
import {
  HostRequestSchema, type DuplicateMatch, type GenerationRequest, type HostMessage, type LearningDocument,
} from "@immersive/core";
import { getAgentCatalog } from "./agents";
import { listCustomAgents, saveCustomAgent, removeCustomAgent, testCustomConfig, resolveCustomExecutable } from "./agents/custom";
import { discoverAgentModels } from "./agents/metadata";
import { listAgentProfiles, saveAgentProfile, removeAgentProfile } from "./agents/profiles";
import { findLocalDuplicates, requestKey } from "./duplicates";
import { findDriveDuplicates, listDriveLessons, getDriveDocument, validateDriveAccess } from "./drive/api";
import { accessTokenFor, connectGoogleAccount, disconnectGoogleAccount, googleConfigured, listGoogleAccounts } from "./drive/oauth";
import { JobManager } from "./jobs/manager";
import { toMarkdown } from "./generation/markdown";
import { encodeMessage, NativeFramer } from "./protocol";
import { localStoragePorts } from "./storage/file";
import { chooseLocalFolder, validateFolder } from "./storage/folders";
import { publishSavedJob } from "./storage/publish";
import { backupSavedJob, resumePendingBackups } from "./storage/backup";
// Keep earlier filesystem/synced-drive compatibility endpoints for existing users.
import { findExisting } from "./storage/publisher";
import { listStorageLocations, validateUserStoragePath } from "./storage/locations";

// Bundle-time version from the root release package; an older Host may omit it.
declare const __IMMERSIVE_HOST_VERSION__: string;
const hostVersion = typeof __IMMERSIVE_HOST_VERSION__ === "string"
  ? __IMMERSIVE_HOST_VERSION__ : "dev";
const storage = localStoragePorts();
const manager = new JobManager({ storage }, (requestId, job) => {
  reply({ id: requestId, type: "job", job });
  reply({ id: requestId, type: "progress", jobId: job.id, completed: job.completed, total: job.total });
});
const checks = new Map<string, { fingerprint: string; shown: Set<string>; expires: number }>();

function reply(message: HostMessage): void {
  process.stdout.write(encodeMessage(message));
}

function deliverDocument(requestId: string, document: LearningDocument): void {
  const bytes = Buffer.from(JSON.stringify(document), "utf8");
  if (bytes.length < 500_000) {
    reply({ id: requestId, type: "result", document });
    return;
  }
  const chunkSize = 256 * 1024;
  const total = Math.ceil(bytes.length / chunkSize);
  for (let index = 0; index < total; index++) {
    const chunk = bytes.subarray(index * chunkSize, (index + 1) * chunkSize);
    reply({
      id: requestId, type: "documentChunk", documentId: document.id, index, total,
      dataBase64: chunk.toString("base64"),
    });
  }
}

async function duplicates(request: GenerationRequest): Promise<DuplicateMatch[]> {
  if (request.destination?.kind === "drive") {
    // A remote permission/authentication failure must never be reported as "no duplicates".
    const [local, remote] = await Promise.all([
      findLocalDuplicates(request, storage), findDriveDuplicates(request),
    ]);
    const found = new Map<string, DuplicateMatch>();
    for (const entry of [...remote, ...local]) {
      const previous = found.get(entry.documentId);
      found.set(entry.documentId, previous && previous.local ? previous : entry);
    }
    return [...found.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
  await validateFolder(request.destination?.kind === "local" ? request.destination.directory : undefined);
  return findLocalDuplicates(request, storage);
}

async function finishDocument(requestId: string, document: LearningDocument): Promise<void> {
  try {
    const location = await publishSavedJob(storage, document.id);
    reply({ id: requestId, type: "published", jobId: document.id, location });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Publishing failed";
    reply({ id: requestId, type: "publicationFailed", jobId: document.id, message: message.slice(0, 900) });
  }
  // A complete local lesson is available immediately; the background controller
  // keeps the Host connected until optional Drive backup has settled.
  deliverDocument(requestId, document);
  try {
    const location = await backupSavedJob(storage, document.id);
    if (location) reply({ id: requestId, type: "backupPublished", jobId: document.id, location });
  } catch (error) {
    reply({ id: requestId, type: "backupFailed", jobId: document.id,
      message: error instanceof Error ? error.message : String(error) });
  } finally {
    reply({ id: requestId, type: "generationSettled" });
  }
}

async function handle(input: unknown): Promise<void> {
  const parsed = HostRequestSchema.safeParse(input);
  if (!parsed.success) {
    const maybeId = input && typeof input === "object" && "id" in input && typeof input.id === "string"
      ? input.id : "invalid-request";
    reply({ id: maybeId, type: "error", message: "Invalid request: " + parsed.error.issues[0]?.message });
    return;
  }
  const request = parsed.data;
  try {
    switch (request.type) {
      case "health": {
        const agents = await getAgentCatalog();
        reply({ id: request.id, type: "health", agents, version: hostVersion,
          installed: Object.fromEntries(agents.map(agent => [agent.id, agent.installed])) });
        break;
      }
      case "customAgentList":
        reply({ id: request.id, type: "customAgentList", agents: await listCustomAgents() });
        break;
      case "customAgentSave":
        reply({ id: request.id, type: "customAgentList",
          agents: await saveCustomAgent(request.config) });
        break;
      case "customAgentRemove":
        reply({ id: request.id, type: "customAgentList",
          agents: await removeCustomAgent(request.agentId) });
        break;
      case "customAgentTest": {
        const label = await testCustomConfig(request.config, request.modelId);
        reply({ id: request.id, type: "customAgentTested", label });
        break;
      }
      case "customAgentProbe": {
        const resolved = await resolveCustomExecutable(request.executable);
        reply({ id: request.id, type: "customAgentProbed", installed: !!resolved,
          ...(resolved ? { resolved } : {}) });
        break;
      }
      case "agentModels": {
        const result = await discoverAgentModels(request.settings);
        reply({ id: request.id, type: "agentModels", ...result });
        break;
      }
      case "agentProfiles":
        reply({ id: request.id, type: "agentProfiles", profiles: await listAgentProfiles() });
        break;
      case "agentProfileSave":
        reply({ id: request.id, type: "agentProfiles",
          profiles: await saveAgentProfile(request.provider, request.label, request.directory) });
        break;
      case "agentProfileRemove":
        reply({ id: request.id, type: "agentProfiles", profiles: await removeAgentProfile(request.profileId) });
        break;
      case "listJobs":
        reply({ id: request.id, type: "jobs", jobs: await manager.list() });
        break;
      case "listLessons": {
        const [documents, summaries] = await Promise.all([
          storage.documents.list(500), storage.jobs.list(5000),
        ]);
        const byId = new Map(summaries.map(summary => [summary.documentId, summary]));
        reply({ id: request.id, type: "lessons", lessons: documents.map(doc => ({
          documentId: doc.id, title: doc.source.title, createdAt: doc.createdAt,
          targetLanguage: doc.profile.targetLanguage, level: doc.profile.level,
          ...(byId.get(doc.id)?.backup ? { backup: byId.get(doc.id)!.backup } : {}),
        })) });
        break;
      }
      case "listDriveLessons":
        reply({ id: request.id, type: "driveLessons", lessons: await listDriveLessons(request.accountId) });
        break;
      case "restoreDriveLesson": {
        const document = await getDriveDocument(request.accountId, request.documentId);
        const existing = await storage.documents.get(document.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(document)) {
          throw new Error("本地已有不同版本的相同教材，請先處理衝突");
        }
        if (!existing) await storage.documents.save(document, toMarkdown(document));
        reply({ id: request.id, type: "driveRestored", documentId: document.id });
        break;
      }
      case "backupExisting": {
        await accessTokenFor(request.accountId);
        let count = 0;
        for (const summary of await storage.jobs.list(5000)) {
          if (summary.status !== "completed" || !summary.documentId ||
              summary.publication?.status !== "published" ||
              (summary.backup?.status === "backed-up" && summary.backup.accountId === request.accountId)) continue;
          await storage.jobs.update(summary.id, current => ({
            ...current, request: { ...current.request,
              backup: { enabled: true, accountId: request.accountId } },
            summary: { ...current.summary,
              backup: { status: "pending", accountId: request.accountId,
                updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() },
          }));
          count++;
        }
        reply({ id: request.id, type: "backupsScheduled", count });
        break;
      }
      case "resumeBackups":
        await resumePendingBackups(storage);
        reply({ id: request.id, type: "backupsFinished" });
        break;
      case "storageLocations":
        reply({ id: request.id, type: "storageLocations", locations: await listStorageLocations() });
        break;
      case "preflight": {
        const root = validateUserStoragePath(request.payload.outputPath ?? (await listStorageLocations())[0].path);
        reply({ id: request.id, type: "preflight", existing: await findExisting(root, request.payload) });
        break;
      }
      case "chooseFolder":
        reply({ id: request.id, type: "folder", directory: await chooseLocalFolder() });
        break;
      case "driveAccounts":
        reply({ id: request.id, type: "driveAccounts",
          accounts: await listGoogleAccounts(), configured: await googleConfigured() });
        break;
      case "driveDisconnect":
        await disconnectGoogleAccount(request.accountId);
        reply({ id: request.id, type: "driveDisconnected", accountId: request.accountId });
        break;
      case "driveConnect":
        reply({ id: request.id, type: "driveConnected", account: await connectGoogleAccount() });
        break;
      case "driveValidate":
        await validateDriveAccess(request.accountId);
        reply({ id: request.id, type: "driveValidated", accountId: request.accountId });
        break;
      case "checkDuplicates": {
        const matches = await duplicates(request.payload);
        const token = randomUUID();
        checks.set(token, {
          fingerprint: requestKey(request.payload),
          shown: new Set(matches.map(item => item.documentId)),
          expires: Date.now() + 10 * 60_000,
        });
        reply({ id: request.id, type: "duplicates", token, matches });
        break;
      }
      case "generate": {
        const checked = checks.get(request.checkToken);
        if (!checked || checked.expires < Date.now() ||
          checked.fingerprint !== requestKey(request.payload)) {
          throw new Error("請先檢查是否已有教材；生成設定變更後必須重新檢查");
        }
        // Recheck immediately before creating a job; don't authorize newly appeared duplicates.
        const current = await duplicates(request.payload);
        if (current.some(item => !checked.shown.has(item.documentId))) {
          throw new Error("找到新的既有教材，請重新檢查再決定是否生成");
        }
        if (current.length && !request.confirmRegeneration) {
          throw new Error("此來源已生成過；請先確認是否重新生成");
        }
        checks.delete(request.checkToken);
        const doc = await manager.start(request.id, request.payload);
        await finishDocument(request.id, doc);
        break;
      }
      case "getDocument": {
        const document = await storage.documents.get(request.documentId);
        if (!document) throw new Error("Saved document not found");
        deliverDocument(request.id, document);
        break;
      }
      case "retryBackup": {
        try {
          const location = await backupSavedJob(storage, request.jobId);
          if (!location) throw new Error("This lesson has no enabled Google Drive backup");
          reply({ id: request.id, type: "backupPublished", jobId: request.jobId, location });
        } catch (error) {
          reply({ id: request.id, type: "backupFailed", jobId: request.jobId,
            message: error instanceof Error ? error.message : String(error) });
        }
        break;
      }
      case "publishJob": {
        try {
          const location = await publishSavedJob(storage, request.jobId);
          reply({ id: request.id, type: "published", jobId: request.jobId, location });
        } catch (error) {
          reply({ id: request.id, type: "publicationFailed", jobId: request.jobId,
            message: error instanceof Error ? error.message : "Publishing failed" });
        }
        break;
      }
      case "cancel": {
        const cancelled = await manager.cancel(request.jobId);
        if (!cancelled) throw new Error("Job is not cancellable or does not exist");
        reply({ id: request.id, type: "cancelled" });
        break;
      }
      case "resume":
        await finishDocument(request.id, await manager.resume(request.id, request.jobId));
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Host error";
    reply({ id: request.id, type: "error", message: message.slice(0, 1200) });
  }
}

const framer = new NativeFramer(message => {
  void handle(message).catch(error => {
    process.stderr.write("Host request failed: " + String(error) + "\n");
  });
});
process.stdin.on("data", (chunk: Buffer) => {
  try {
    framer.push(chunk);
  } catch (error) {
    process.stderr.write("Invalid native frame: " + String(error) + "\n");
    process.exitCode = 1;
    process.stdin.pause();
  }
});
process.stdin.on("end", () => manager.interruptAll());
