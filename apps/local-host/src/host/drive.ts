import type { HostRequest } from "@contextual/core";
import {
  listDriveLessons,
  getDriveDocument,
  validateDriveAccess,
  existingDriveFolder,
} from "../drive/api";
import {
  accessTokenFor,
  connectGoogleAccount,
  disconnectGoogleAccount,
  googleConfigured,
  listGoogleAccounts,
} from "../drive/oauth";
import { chooseLocalFolder } from "../storage/folders";
import { openLocalFolder } from "../platform/folder-opener";
import { resumePendingBackups } from "../storage/backup";
import { createDocumentSync } from "../storage/document-sync";
import type { HostDispatcherDeps } from "./context";

/** Drive account, restore and backup scheduling operations. */
export async function handleDriveRequest(
  request: HostRequest,
  { storage, reply }: Pick<HostDispatcherDeps, "storage" | "reply">,
): Promise<boolean> {
  switch (request.type) {
    case "listDriveLessons":
      reply({
        id: request.id,
        type: "driveLessons",
        lessons: await listDriveLessons(request.accountId),
      });
      return true;
    case "restoreDriveLesson": {
      await createDocumentSync(storage).restore(request.documentId, () =>
        getDriveDocument(request.accountId, request.documentId),
      );
      reply({ id: request.id, type: "driveRestored", documentId: request.documentId });
      return true;
    }
    case "backupExisting": {
      await accessTokenFor(request.accountId);
      let count = 0;
      for (const summary of await storage.jobs.listRecords()) {
        if (await createDocumentSync(storage).setBackupAccount(summary.id, request.accountId))
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
    case "openFolder":
      reply({
        id: request.id,
        type: "folderOpened",
        directory: await openLocalFolder(request.directory),
      });
      return true;
    case "driveAccounts":
      reply({
        id: request.id,
        type: "driveAccounts",
        accounts: await listGoogleAccounts(),
        configured: await googleConfigured(),
      });
      return true;
    case "driveDisconnect":
      await disconnectGoogleAccount(request.accountId);
      reply({ id: request.id, type: "driveDisconnected", accountId: request.accountId });
      return true;
    case "driveConnect":
      reply({ id: request.id, type: "driveConnected", account: await connectGoogleAccount() });
      return true;
    case "driveFolder":
      reply({
        id: request.id,
        type: "driveFolder",
        accountId: request.accountId,
        url: await existingDriveFolder(request.accountId),
      });
      return true;
    case "driveValidate":
      await validateDriveAccess(request.accountId);
      reply({ id: request.id, type: "driveValidated", accountId: request.accountId });
      return true;
    default:
      return false;
  }
}
