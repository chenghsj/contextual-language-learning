import type { HostMessage, HostRequest, LearningDocument } from "@immersive/core";
import { publishSavedJob } from "../storage/publish";
import { backupSavedJob } from "../storage/backup";
import type { StoragePorts } from "../storage/ports";

/** Local publication and optional Drive backup share one completed canonical document. */
export function createPublicationFlow(storage: StoragePorts, reply: (message: HostMessage) => void) {
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

  async function handle(request: HostRequest): Promise<boolean> {
    switch (request.type) {
      case "retryBackup": {
        try {
          const location = await backupSavedJob(storage, request.jobId);
          if (!location) throw new Error("This lesson has no enabled Google Drive backup");
          reply({ id: request.id, type: "backupPublished", jobId: request.jobId, location });
        } catch (error) {
          reply({ id: request.id, type: "backupFailed", jobId: request.jobId,
            message: error instanceof Error ? error.message : String(error) });
        }
        return true;
      }
      case "publishJob": {
        try {
          const location = await publishSavedJob(storage, request.jobId);
          reply({ id: request.id, type: "published", jobId: request.jobId, location });
        } catch (error) {
          reply({ id: request.id, type: "publicationFailed", jobId: request.jobId,
            message: error instanceof Error ? error.message : "Publishing failed" });
        }
        return true;
      }
      default: return false;
    }
  }
  return { deliverDocument, finishDocument, handle };
}
