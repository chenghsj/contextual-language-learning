import type { HostRequest } from "@immersive/core";
import { listDriveLessons, getDriveDocument, validateDriveAccess } from "../drive/api";
import { accessTokenFor, connectGoogleAccount, disconnectGoogleAccount, googleConfigured, listGoogleAccounts } from "../drive/oauth";
import { toMarkdown } from "../generation/markdown";
import { chooseLocalFolder } from "../storage/folders";
import { resumePendingBackups } from "../storage/backup";
import type { HostDispatcherDeps } from "./context";

/** Drive account, restore and backup scheduling operations. */
export async function handleDriveRequest(request: HostRequest,
  { storage, reply }: Pick<HostDispatcherDeps, "storage" | "reply">): Promise<boolean> {
  switch (request.type) {
      case "listDriveLessons":
        reply({ id: request.id, type: "driveLessons", lessons: await listDriveLessons(request.accountId) });
        return true;
      case "restoreDriveLesson": {
        const document = await getDriveDocument(request.accountId, request.documentId);
        const existing = await storage.documents.get(document.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(document)) {
          throw new Error("本地已有不同版本的相同教材，請先處理衝突");
        }
        if (!existing) await storage.documents.save(document, toMarkdown(document));
        reply({ id: request.id, type: "driveRestored", documentId: document.id });
        return true;
      }
      case "backupExisting": {
        await accessTokenFor(request.accountId);
        let count = 0;
        for (const summary of await storage.jobs.listRecords()) {
          if (summary.status !== "completed" || !summary.documentId ||
              summary.publication?.status !== "published" ||
              (summary.backup?.status === "backed-up" && summary.backup.accountId === request.accountId)) continue;
          await storage.jobs.updateRecord(summary.id, current => ({
            ...current, request: { ...current.request,
              backup: { enabled: true, accountId: request.accountId } },
            summary: { ...current.summary,
              backup: { status: "pending", accountId: request.accountId,
                updatedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() },
          }));
          count++;
        }
        reply({ id: request.id, type: "backupsScheduled", count });
        return true;
      }
      case "resumeBackups":
        await resumePendingBackups(storage);
        reply({ id: request.id, type: "backupsFinished" });
        return true;
      case "chooseFolder":
        reply({ id: request.id, type: "folder", directory: await chooseLocalFolder() });
        return true;
      case "driveAccounts":
        reply({ id: request.id, type: "driveAccounts",
          accounts: await listGoogleAccounts(), configured: await googleConfigured() });
        return true;
      case "driveDisconnect":
        await disconnectGoogleAccount(request.accountId);
        reply({ id: request.id, type: "driveDisconnected", accountId: request.accountId });
        return true;
      case "driveConnect":
        reply({ id: request.id, type: "driveConnected", account: await connectGoogleAccount() });
        return true;
      case "driveValidate":
        await validateDriveAccess(request.accountId);
        reply({ id: request.id, type: "driveValidated", accountId: request.accountId });
        return true;
    default: return false;
  }
}
