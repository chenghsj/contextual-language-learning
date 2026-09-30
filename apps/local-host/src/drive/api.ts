import { createHash, randomBytes } from "node:crypto";
import { readLearningDocument, type DriveLessonSummary, type DuplicateMatch, type GenerationRequest, type LearningDocument } from "@immersive/core";
import { settingsKey, sourceKey, transcriptKey } from "../duplicates";
import { learningDocumentToMarkdown as toMarkdownForDrive } from "@immersive/core";
import { accessTokenFor, listGoogleAccounts } from "./oauth";

interface DriveFile {
  id: string;
  name: string;
  createdTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}
interface DriveList { files?: DriveFile[]; nextPageToken?: string }
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const FOLDER_NAME = "Immersive Learning";
/** Drive limits every appProperties key + value pair to 124 UTF-8 bytes, not characters. */
export const MAX_DRIVE_PROPERTY_BYTES = 124;
const MAX_DRIVE_PRIVATE_PROPERTIES = 30;

/** Truncate display metadata only; the full source title remains in the saved lesson JSON. */
export function boundedDriveProperty(key: string, value: string): string {
  const budget = MAX_DRIVE_PROPERTY_BYTES - Buffer.byteLength(key, "utf8");
  if (budget < 0) throw new Error("Drive metadata key exceeds the UTF-8 size limit");
  let result = "";
  let bytes = 0;
  for (const codePoint of value) {
    const nextBytes = Buffer.byteLength(codePoint, "utf8");
    if (bytes + nextBytes > budget) break;
    result += codePoint;
    bytes += nextBytes;
  }
  return result;
}

/** Check all properties for initial uploads and subsequent playback-only revisions. */
export function validateDriveAppProperties(properties: Record<string, string>): void {
  if (Object.keys(properties).length > MAX_DRIVE_PRIVATE_PROPERTIES) {
    throw new Error("Drive metadata exceeds the private property count limit");
  }
  for (const [key, value] of Object.entries(properties)) {
    if (Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8") >
        MAX_DRIVE_PROPERTY_BYTES) {
      throw new Error("Drive metadata exceeds the UTF-8 property size limit");
    }
  }
}

/** Never display raw Google responses: they can contain private file metadata or request details. */
export function driveApiError(status: number, body: unknown, operation: string): Error {
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const error = payload.error && typeof payload.error === "object"
    ? payload.error as Record<string, unknown> : {};
  const reasons = Array.isArray(error.errors)
    ? error.errors.filter((entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object") : [];
  // Newer Google APIs often put the actionable cause in error.details[]
  // instead of legacy error.errors[]. Never expose error.message, URLs or tokens.
  const details = Array.isArray(error.details)
    ? error.details.filter((entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object") : [];
  const clean = (value: unknown): string => typeof value === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : "";
  const reason = clean(reasons.find(entry => clean(entry.reason))?.reason) ||
    clean(details.find(entry => clean(entry.reason))?.reason) ||
    clean(error.status) || "unknown";
  let hint = "請確認目前帳號的 Google Drive 權限，並重試。";
  if (["accessNotConfigured", "SERVICE_DISABLED", "API_DISABLED"].includes(reason)) {
    hint = "Google Drive API 尚未啟用；請在 OAuth 用戶端所屬的 Google Cloud 專案啟用 Drive API。";
  } else if (["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"].includes(reason)) {
    hint = "目前授權缺少 Google Drive 所需範圍；請重新連結並確認 drive.file 權限。";
  } else if (reason === "PERMISSION_DENIED") {
    hint = "Google Drive 拒絕存取；請確認 Drive API 已啟用、帳號與檔案權限。不要只因已完成 Google 登入就假設可使用 Drive。";
  } else if (reason === "propertyLengthLimitExceeded") {
    hint = "Google Drive 的檔案屬性超過 UTF-8 長度限制；請更新 Native Host 後重試備份，不需要重新授權。";
  } else if (reason === "appNotAuthorizedToFile" || reason === "forbidden") {
    hint = "這個 Google 帳號沒有存取此檔案的權限；請確認備份帳號及檔案是否由本應用程式建立。";
  } else if (["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded",
    "dailyLimitExceeded", "RESOURCE_EXHAUSTED"].includes(reason)) {
    hint = "Google Drive 暫時限制請求量；請稍後再試，不需要重新授權。";
  } else if (status === 401 || reason === "authError" || reason === "UNAUTHENTICATED") {
    hint = "Google 授權可能已失效；請重新連結此帳號。";
  } else if (status === 403) {
    hint = "Google Drive 拒絕此操作；請確認 Drive API、所選帳號與 drive.file 權限。";
  }
  const label = ["驗證 Drive 權限", "列出雲端教材", "讀取雲端教材", "備份教材"].includes(operation)
    ? operation : "Google Drive 操作";
  return new Error(label + "失敗（HTTP " + status + "，" + reason + "）。" + hint);
}

async function googleFetch(accountId: string, url: string, init: RequestInit = {}, operation = "Google Drive 操作"): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + await accessTokenFor(accountId));
  const response = await fetch(url, {
    ...init, headers, signal: init.signal ?? AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw driveApiError(response.status, data, operation);
  }
  return response;
}

async function apiJSON<T>(accountId: string, url: string, init: RequestInit = {}, operation?: string): Promise<T> {
  const response = await googleFetch(accountId, url, init, operation);
  return await response.json() as T;
}

async function listFiles(accountId: string, query: string, fields: string, limit = 100,
  operation = "列出雲端教材"): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(API + "/files");
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "nextPageToken,files(" + fields + ")");
    url.searchParams.set("pageSize", String(Math.min(limit, 1000)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await apiJSON<DriveList>(accountId, url.toString(), {}, operation);
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && files.length < limit);
  return files.slice(0, limit);
}

/** Test the actual Drive API using the selected account; a cached access token is not sufficient. */
export async function validateDriveAccess(accountId: string): Promise<void> {
  if (!(await listGoogleAccounts()).some(account => account.id === accountId)) {
    throw new Error("請先連結所選的 Google Drive 帳號");
  }
  await listFiles(accountId, "trashed = false", "id", 1, "驗證 Drive 權限");
}

function propertyMatch(key: string, value: string): string {
  if (!/^[A-Za-z0-9]{1,80}$/.test(key) || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Invalid Drive lookup property");
  }
  return "appProperties has { key='" + key + "' and value='" + value + "' }";
}

async function appFolder(accountId: string): Promise<string> {
  const folders = await listFiles(accountId,
    "name = '" + FOLDER_NAME + "' and mimeType = '" + FOLDER_TYPE + "' and trashed = false",
    "id,name", 10);
  if (folders[0]) return folders[0].id;
  const created = await apiJSON<DriveFile>(accountId, API + "/files?fields=id,name", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_TYPE }),
  });
  return created.id;
}

async function uploadFile(
  accountId: string, folderId: string, fileName: string, mimeType: string, data: Buffer,
  properties: Record<string, string>,
): Promise<DriveFile> {
  validateDriveAppProperties(properties);
  const metadata = {
    name: fileName, mimeType, parents: [folderId], appProperties: properties,
  };
  if (data.length > 5_000_000) {
    const start = await googleFetch(accountId,
      UPLOAD + "/files?uploadType=resumable&fields=id,name,webViewLink,appProperties", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Upload-Content-Type": mimeType, "X-Upload-Content-Length": String(data.length),
        },
        body: JSON.stringify(metadata),
      });
    const location = start.headers.get("Location");
    if (!location) throw new Error("Google Drive did not return an upload session");
    const url = new URL(location);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".googleapis.com")) {
      throw new Error("Unexpected Google Drive upload endpoint");
    }
    return apiJSON<DriveFile>(accountId, url.toString(), {
      method: "PUT", headers: { "Content-Type": mimeType, "Content-Length": String(data.length) },
      body: new Uint8Array(data),
    });
  }
  const boundary = "immersive_" + randomBytes(12).toString("hex");
  const body = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) + "\r\n--" + boundary +
      "\r\nContent-Type: " + mimeType + "\r\n\r\n", "utf8"),
    data,
    Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);
  return apiJSON<DriveFile>(accountId,
    UPLOAD + "/files?uploadType=multipart&fields=id,name,webViewLink,appProperties", {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body: new Uint8Array(body),
    });
}

export async function findDriveDuplicates(request: GenerationRequest): Promise<DuplicateMatch[]> {
  if (request.destination?.kind !== "drive") return [];
  const accountId = request.destination.accountId;
  // Do not silently treat an OAuth/network failure as "not generated".
  const accounts = await listGoogleAccounts();
  const account = accounts.find(item => item.id === accountId);
  if (!account) throw new Error("請先連線所選的 Google Drive 帳號");
  const key = sourceKey(request.source, request.cues);
  const transcript = transcriptKey(request.cues);
  const files = await listFiles(accountId,
    "(" + propertyMatch("immersiveSourceKey", key) + " or " +
      propertyMatch("immersiveTranscriptKey", transcript) + ") and trashed = false",
    "id,name,createdTime,webViewLink,appProperties", 100);
  const expected = settingsKey(request);
  return files.filter(file => file.appProperties?.immersiveFormat === "json")
    .map(file => ({
      documentId: file.appProperties?.immersiveDocumentId ?? "",
      title: file.name, createdAt: file.createdTime ?? new Date(0).toISOString(),
      destination: "Google Drive · " + account.email,
      exactSettings: file.appProperties?.immersiveSettingsKey === expected,
      local: false, url: file.webViewLink ?? "https://drive.google.com/file/d/" + encodeURIComponent(file.id) + "/view",
    })).filter(match => /^[0-9a-f-]{36}$/i.test(match.documentId));
}

export class DriveContentConflict extends Error {
  constructor(message: string) { super(message); this.name = "DriveContentConflict"; }
}

/** A revision may change ONLY the user's optional V3 playback windows, never the video or lesson. */
export function isPlaybackOnlyDriveRevision(before: LearningDocument, after: LearningDocument): boolean {
  if (before.schemaVersion !== 3 || after.schemaVersion !== 3 || before.id !== after.id) return false;
  const { playbackOverrides: oldRanges, scenePlaybackOverrides: oldScenes, ...oldContent } = before;
  const { playbackOverrides: newRanges, scenePlaybackOverrides: newScenes, ...newContent } = after;
  return JSON.stringify(oldContent) === JSON.stringify(newContent) &&
    (JSON.stringify(oldRanges) !== JSON.stringify(newRanges) ||
      JSON.stringify(oldScenes) !== JSON.stringify(newScenes));
}

/** Markdown's only mutable sections are the generated calibration footers. */
export function isPlaybackOnlyMarkdownRevision(before: string, after: string): boolean {
  const footer = /^## User-calibrated (?:playback|scene playback) \(original .*\)$/m;
  const base = (value: string) => {
    const match = footer.exec(value);
    return (match ? value.slice(0, match.index) : value).trimEnd();
  };
  return before !== after && base(before) === base(after);
}

async function updateOwnedPlaybackBackup(
  accountId: string, file: DriveFile, mimeType: string, content: Buffer,
  oldContent: Buffer, properties: Record<string, string>,
): Promise<DriveFile> {
  validateDriveAppProperties(properties);
  const response = await googleFetch(accountId,
    API + "/files/" + encodeURIComponent(file.id) + "?alt=media", {}, "讀取雲端教材");
  const remote = Buffer.from(await response.arrayBuffer());
  if (remote.length > 25_000_000) throw new DriveContentConflict("Cloud lesson exceeds the update limit");
  if (remote.equals(content)) return file; // idempotent after a partially completed two-file backup
  if (!remote.equals(oldContent)) {
    throw new DriveContentConflict("雲端教材與上次備份不同；保留雲端檔案，請先確認版本");
  }
  const boundary = "immersive_" + randomBytes(12).toString("hex");
  const body = Buffer.concat([
    Buffer.from("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify({ appProperties: properties }) + "\r\n--" + boundary +
      "\r\nContent-Type: " + mimeType + "\r\n\r\n", "utf8"),
    content,
    Buffer.from("\r\n--" + boundary + "--\r\n"),
  ]);
  const etag = response.headers.get("etag");
  return apiJSON<DriveFile>(accountId,
    UPLOAD + "/files/" + encodeURIComponent(file.id) +
      "?uploadType=multipart&fields=id,name,webViewLink,appProperties", {
      method: "PATCH",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary,
        ...(etag ? { "If-Match": etag } : {}) },
      body: new Uint8Array(body),
    }, "備份教材");
}

export async function publishDriveDocument(
  accountId: string, document: LearningDocument, markdown: string,
  previousDocument?: LearningDocument,
): Promise<string> {
  if (previousDocument && !isPlaybackOnlyDriveRevision(previousDocument, document)) {
    throw new DriveContentConflict("Only explicit playback calibration may revise an existing Drive lesson");
  }
  const account = (await listGoogleAccounts()).find(item => item.id === accountId);
  if (!account) throw new Error("Google Drive 帳號尚未連線");
  const folderId = await appFolder(accountId);
  const fingerprint = sourceKey(document.source, document.cues);
  const properties = {
    immersiveSourceKey: fingerprint,
    immersiveTranscriptKey: transcriptKey(document.cues),
    immersiveSettingsKey: settingsKey({ profile: document.profile, agent: document.generation }),
    immersiveDocumentId: document.id,
    immersiveSchemaVersion: String(document.schemaVersion),
    immersiveTitle: boundedDriveProperty("immersiveTitle", document.source.title),
    immersiveCreatedAt: document.createdAt,
  };
  const docKey = createHash("sha256").update(document.id).digest("hex");
  const found = await listFiles(accountId,
    "trashed = false and " + propertyMatch("immersiveDocumentKey", docKey),
    "id,name,webViewLink,appProperties", 100);
  let jsonUrl = "";
  for (const format of ["json", "md"] as const) {
    const name = "Immersive-" + document.id + "." + format;
    const content = Buffer.from(format === "json" ? JSON.stringify(document, null, 2) + "\n" : markdown, "utf8");
    const expectedHash = createHash("sha256").update(content).digest("hex");
    const existing = found.filter(file => file.appProperties?.immersiveFormat === format);
    if (existing.length > 1) {
      throw new DriveContentConflict("Multiple Drive backups exist for the same lesson format; no file was overwritten");
    }
    const metadata = { ...properties, immersiveFormat: format, immersiveDocumentKey: docKey,
      immersiveContentHash: expectedHash };
    validateDriveAppProperties(metadata);
    const oldContent = previousDocument && Buffer.from(format === "json"
      ? JSON.stringify(previousDocument, null, 2) + "\n"
      : toMarkdownForDrive(previousDocument), "utf8");
    const file = existing[0]
      ? previousDocument && oldContent
        ? await updateOwnedPlaybackBackup(accountId, existing[0],
            format === "json" ? "application/json" : "text/markdown", content, oldContent, metadata)
        : await (async () => {
            const response = await googleFetch(accountId,
              API + "/files/" + encodeURIComponent(existing[0].id) + "?alt=media", {}, "讀取雲端教材");
            const remote = Buffer.from(await response.arrayBuffer());
            if (remote.length > 25_000_000) throw new DriveContentConflict("Cloud lesson exceeds the update limit");
            const remoteHash = createHash("sha256").update(remote).digest("hex");
            const recordedHash = existing[0].appProperties?.immersiveContentHash;
            if (recordedHash && remoteHash !== recordedHash) {
              throw new DriveContentConflict("雲端教材已在應用程式外變更；已保留兩邊檔案");
            }
            if (remoteHash === expectedHash) return existing[0];
            if (!recordedHash) {
              throw new DriveContentConflict("雲端教材缺少原始校驗值；已保留兩邊檔案，請先確認版本");
            }
            const recoverable = format === "json"
              ? (() => {
                  try { return isPlaybackOnlyDriveRevision(readLearningDocument(JSON.parse(remote.toString("utf8")) as unknown), document); }
                  catch { return false; }
                })()
              : isPlaybackOnlyMarkdownRevision(remote.toString("utf8"), markdown);
            if (!recoverable) {
              throw new DriveContentConflict("雲端教材 " + name + " 的內容不同；已保留兩邊檔案，請先確認版本");
            }
            return updateOwnedPlaybackBackup(accountId, existing[0],
              format === "json" ? "application/json" : "text/markdown", content, remote, metadata);
          })()
      : await uploadFile(accountId, folderId, name,
          format === "json" ? "application/json" : "text/markdown", content, metadata);
    if (format === "json") jsonUrl = file.webViewLink ??
      "https://drive.google.com/file/d/" + encodeURIComponent(file.id) + "/view";
  }
  return jsonUrl;
}

export async function listDriveLessons(accountId: string): Promise<DriveLessonSummary[]> {
  if (!(await listGoogleAccounts()).some(account => account.id === accountId)) {
    throw new Error("Google Drive account is not connected");
  }
  const files = await listFiles(accountId,
    "trashed = false and appProperties has { key='immersiveFormat' and value='json' }",
    "id,name,createdTime,webViewLink,appProperties", 500);
  const unique = new Map<string, DriveLessonSummary>();
  for (const file of files) {
    const id = file.appProperties?.immersiveDocumentId;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id) || unique.has(id)) continue;
    unique.set(id, {
      documentId: id,
      title: file.appProperties?.immersiveTitle || "Immersive lesson " + id.slice(0, 8),
      createdAt: file.appProperties?.immersiveCreatedAt || file.createdTime || new Date(0).toISOString(),
      accountId,
      url: file.webViewLink || "https://drive.google.com/file/d/" + encodeURIComponent(file.id) + "/view",
    });
  }
  return [...unique.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Read and validate one app-owned Drive JSON file before importing it locally. */
export async function getDriveDocument(accountId: string, documentId: string): Promise<LearningDocument> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw new Error("Invalid lesson ID");
  if (!(await listGoogleAccounts()).some(account => account.id === accountId)) {
    throw new Error("Google Drive account is not connected");
  }
  const key = createHash("sha256").update(documentId).digest("hex");
  const files = await listFiles(accountId,
    "trashed = false and " + propertyMatch("immersiveDocumentKey", key),
    "id,name,appProperties", 100);
  const file = files.find(item => item.appProperties?.immersiveFormat === "json" &&
    item.appProperties?.immersiveDocumentId === documentId);
  if (!file) throw new Error("Lesson not found in Google Drive");
  const response = await googleFetch(accountId,
    API + "/files/" + encodeURIComponent(file.id) + "?alt=media");
  if (Number(response.headers.get("Content-Length") ?? 0) > 25_000_000) {
    throw new Error("Drive lesson exceeds the import size limit");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 25_000_000) throw new Error("Drive lesson exceeds the import size limit");
  const checksum = file.appProperties?.immersiveContentHash;
  if (checksum && createHash("sha256").update(bytes).digest("hex") !== checksum) {
    throw new DriveContentConflict("Drive lesson does not match its recorded checksum");
  }
  const document = readLearningDocument(JSON.parse(bytes.toString("utf8")) as unknown);
  if (document.id !== documentId) throw new DriveContentConflict("Drive lesson ID does not match requested ID");
  return document;
}
