import { CustomChunkAssembler } from "./custom-chunks";
import { FavoriteChunkAssembler, sameFavoriteCollection } from "./favorite-chunks";
import {
  BackgroundGenerationStateSchema,
  HostMessageSchema,
  HostRequestSchema,
  readLearningDocument,
  parseFavoriteSnapshot,
  type FavoriteCollection,
  type FavoriteSnapshot,
  type HostRequest,
  type HostMessage,
  type LearningDocument,
  type JobSummary,
} from "@contextual/core";
import {
  GENERATION_CONTROLLER_PORT,
  type GenerationControllerMessage,
} from "./generation-controller";
import { DocumentChunkAssembler } from "./document-chunks";

export type HostStream = { send(input: HostRequest | { type: "watch" }): void; close(): void };
/** Panel requests go through the worker; health probes use a fresh Native connection. */
export function openHostStream(
  onMessage: (message: GenerationControllerMessage) => void,
  onError: (error: Error) => void,
  runtime: typeof chrome.runtime = chrome.runtime,
): HostStream {
  const port = runtime.connect({ name: GENERATION_CONTROLLER_PORT });
  let closed = false;
  function close() {
    if (!closed) {
      closed = true;
      port.disconnect();
    }
  }
  function fail(error: Error) {
    if (closed) return;
    close();
    onError(error);
  }
  port.onMessage.addListener((raw: unknown) => {
    if (closed) return;
    const state = BackgroundGenerationStateSchema.safeParse(raw);
    if (state.success) {
      onMessage(state.data);
      return;
    }
    const message = HostMessageSchema.safeParse(raw);
    if (!message.success) {
      fail(new Error("Native Host returned an invalid response. Update the Host and try again."));
      return;
    }
    onMessage(message.data);
  });
  port.onDisconnect.addListener(() =>
    fail(new Error(runtime.lastError?.message ?? "Background Host connection ended")),
  );
  return {
    close,
    send(input) {
      if (closed) throw new Error("Host subscription is closed");
      const checked =
        input.type === "watch" ? { type: "watch" as const } : HostRequestSchema.parse(input);
      port.postMessage(checked);
    },
  };
}

const responseTypes = {
  favoriteStates: "favoriteStates",
  setFavorite: "favoriteChanged",
  listFavorites: "favorites",
  configureFavorites: "favoriteStatus",
  favoriteStatus: "favoriteStatus",
  syncFavorites: "favoriteStatus",
  estimateGeneration: "generationEstimate",
  health: "health",
  checkCustomDuplicates: "duplicates",
  getJobExecution: "jobExecution",
  listCustomDocuments: "customDocuments",
  listCustomDriveDocuments: "customDriveDocuments",
  restoreCustomDriveDocument: "customDocumentChanged",
  renameCustomDocument: "customDocumentChanged",
  deleteCustomDocument: "customDocumentChanged",
  agentModels: "agentModels",
  discoverModels: "discoveredModels",
  getLocalModelConfig: "localModelConfig",
  setLocalModelConfig: "localModelConfig",
  testLocalModelConfig: "localModelTest",
  piProviders: "piProviders",
  piLogout: "piProviders",
  listEndedJobs: "jobs",
  listJobs: "jobs",
  deleteJobHistory: "jobHistoryDeleted",
  listLessons: "lessons",
  deleteLocalLesson: "localLessonDeleted",
  listDriveLessons: "driveLessons",
  restoreDriveLesson: "driveRestored",
  backupExisting: "backupsScheduled",
  savePlaybackRange: "playbackRangeSaved",
  saveScenePlaybackRange: "scenePlaybackRangeSaved",
  checkDuplicates: "duplicates",
  chooseFolder: "folder",
  openFolder: "folderOpened",
  driveAccounts: "driveAccounts",
  driveConnect: "driveConnected",
  driveDisconnect: "driveDisconnected",
  driveValidate: "driveValidated",
  driveFolder: "driveFolder",
  publishJob: "published",
  retryBackup: "backupPublished",
  resumeBackups: "backupsFinished",
  cancel: "cancelled",
} as const satisfies Partial<Record<HostRequest["type"], HostMessage["type"]>>;
export type OnceRequest = Extract<HostRequest, { type: keyof typeof responseTypes }>;
type Reply<R extends OnceRequest> = Extract<
  HostMessage,
  { type: (typeof responseTypes)[R["type"]] }
>;
/** Resolve only the declared response for this request ID, rejecting domain failures too. */
export function nativeOnce<R extends OnceRequest>(
  input: R,
  runtime: typeof chrome.runtime = chrome.runtime,
): Promise<Reply<R>> {
  const request = HostRequestSchema.parse(input);
  return new Promise((resolve, reject) => {
    const stream = openHostStream(
      message => {
        if (message.type === "generationState" || message.id !== request.id) return;
        if (
          message.type === "error" ||
          message.type === "publicationFailed" ||
          message.type === "backupFailed"
        ) {
          stream.close();
          reject(new Error(message.message));
          return;
        }
        if (message.type !== responseTypes[input.type]) {
          stream.close();
          reject(new Error("Unexpected Host response for " + input.type));
          return;
        }
        stream.close();
        resolve(message as Reply<R>);
      },
      reject,
      runtime,
    );
    try {
      stream.send(request);
    } catch (error) {
      stream.close();
      reject(error);
    }
  });
}
export type RequestInput = OnceRequest extends infer R
  ? R extends OnceRequest
    ? Omit<R, "id">
    : never
  : never;
export function request<R extends RequestInput>(
  input: R,
  runtime?: typeof chrome.runtime,
): Promise<Reply<Extract<OnceRequest, { type: R["type"] }>>>;
export function request(input: RequestInput, runtime: typeof chrome.runtime = chrome.runtime) {
  return nativeOnce({ ...input, id: crypto.randomUUID() }, runtime);
}
export function getFavorite(
  collection: FavoriteCollection,
  key: string,
  runtime: typeof chrome.runtime = chrome.runtime,
): Promise<FavoriteSnapshot> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const chunks = new FavoriteChunkAssembler(collection, key);
    const stream = openHostStream(
      message => {
        if (message.type === "generationState" || message.id !== id) return;
        try {
          if (message.type === "error") throw new Error(message.message);
          let snapshot: FavoriteSnapshot | null;
          if (message.type === "favorite") {
            if (message.key !== key || !sameFavoriteCollection(message.collection, collection))
              throw new Error("Favorite identity mismatch");
            snapshot = parseFavoriteSnapshot(message.snapshot);
          } else if (message.type === "favoriteChunk") {
            snapshot = chunks.push(message);
            if (!snapshot && message.index === message.total - 1)
              throw new Error("Missing favorite chunks");
          } else throw new Error("Unexpected Host favorite response");
          if (snapshot) {
            stream.close();
            resolve(snapshot);
          }
        } catch (error) {
          stream.close();
          reject(error);
        }
      },
      reject,
      runtime,
    );
    try {
      stream.send({ id, type: "getFavorite", collection, key });
    } catch (error) {
      stream.close();
      reject(error);
    }
  });
}

export function getDocument(
  documentId: string,
  runtime: typeof chrome.runtime = chrome.runtime,
): Promise<LearningDocument> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const chunks = new DocumentChunkAssembler();
    const stream = openHostStream(
      message => {
        if (message.type === "generationState" || message.id !== id) return;
        try {
          if (message.type === "error") throw new Error(message.message);
          if (message.type === "result") {
            stream.close();
            resolve(readLearningDocument(message.document));
          } else if (message.type === "documentChunk") {
            const document = chunks.push(message);
            if (document) {
              stream.close();
              resolve(document);
            } else if (message.index === message.total - 1)
              throw new Error("Missing document chunks");
          } else throw new Error("Unexpected Host document response");
        } catch (error) {
          stream.close();
          reject(error);
        }
      },
      reject,
      runtime,
    );
    try {
      stream.send({ type: "getDocument", id, documentId });
    } catch (error) {
      stream.close();
      reject(error);
    }
  });
}

export type JobPreviewInfo = {
  jobId: string;
  revision: number;
  selectedSceneCount: number;
  readySceneIds: string[];
  status: JobSummary["status"];
};
export function getJobPreview(
  jobId: string,
  runtime: typeof chrome.runtime = chrome.runtime,
): Promise<{ info: JobPreviewInfo; document: LearningDocument }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(),
      chunks = new DocumentChunkAssembler();
    let info: JobPreviewInfo | undefined;
    const stream = openHostStream(
      message => {
        if (message.type === "generationState" || message.id !== id) return;
        try {
          if (message.type === "error") throw new Error(message.message);
          if (message.type === "job") {
            const job = message.job;
            if (
              info ||
              job.id !== jobId ||
              job.previewRevision === undefined ||
              job.selectedSceneCount === undefined ||
              !job.readySceneIds?.length
            )
              throw new Error("Preview identity mismatch");
            info = {
              jobId: job.id,
              revision: job.previewRevision,
              selectedSceneCount: job.selectedSceneCount,
              readySceneIds: job.readySceneIds,
              status: job.status,
            };
            return;
          }
          const document =
            message.type === "result"
              ? readLearningDocument(message.document)
              : message.type === "documentChunk"
                ? chunks.push(message)
                : null;
          if (document) {
            if (
              !info ||
              document.id !== jobId ||
              JSON.stringify(document.sections.map(s => s.id)) !==
                JSON.stringify(info.readySceneIds)
            )
              throw new Error("Preview content differs from its revision");
            stream.close();
            resolve({ info, document });
          } else if (message.type === "documentChunk" && message.index === message.total - 1)
            throw new Error("Missing preview chunks");
          else if (message.type !== "documentChunk") throw new Error("Unexpected preview response");
        } catch (error) {
          stream.close();
          reject(error);
        }
      },
      reject,
      runtime,
    );
    try {
      stream.send({ id, type: "getJobPreview", jobId });
    } catch (error) {
      stream.close();
      reject(error);
    }
  });
}

export async function getCustomResource(
  resource: "document",
  resourceId: string,
  runtime?: typeof chrome.runtime,
): Promise<import("@contextual/core").CustomDocument>;
export async function getCustomResource(
  resource: "job",
  resourceId: string,
  runtime?: typeof chrome.runtime,
): Promise<import("@contextual/core").CustomJobSnapshot>;
export async function getCustomResource(
  resource: "document" | "job",
  resourceId: string,
  runtime: typeof chrome.runtime = chrome.runtime,
) {
  return new Promise<
    import("@contextual/core").CustomDocument | import("@contextual/core").CustomJobSnapshot
  >((resolve, reject) => {
    const id = crypto.randomUUID(),
      chunks = new CustomChunkAssembler();
    const stream = openHostStream(
      message => {
        if (message.type === "generationState" || message.id !== id) return;
        try {
          if (message.type === "error") throw new Error(message.message);
          if (
            message.type !== "customChunk" ||
            message.resource !== resource ||
            message.resourceId !== resourceId
          )
            throw new Error("Unexpected custom result");
          const result = chunks.push(message);
          if (result) {
            stream.close();
            resolve(result);
          } else if (message.index === message.total - 1) throw new Error("Missing custom chunks");
        } catch (error) {
          stream.close();
          reject(error);
        }
      },
      reject,
      runtime,
    );
    try {
      stream.send(
        resource === "document"
          ? { id, type: "getCustomDocument", documentId: resourceId }
          : { id, type: "getCustomJob", jobId: resourceId },
      );
    } catch (error) {
      stream.close();
      reject(error);
    }
  });
}
