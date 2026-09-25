import { randomBytes } from "node:crypto";
import type { DuplicateMatch, GenerationRequest, LearningDocument } from "@immersive/core";
import { settingsKey, sourceKey, transcriptKey } from "../duplicates";
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

async function googleFetch(accountId: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: "Bearer " + await accessTokenFor(accountId), ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error("Google Drive request failed (HTTP " + response.status + "); check account permissions or reconnect");
  return response;
}

async function apiJSON<T>(accountId: string, url: string, init: RequestInit = {}): Promise<T> {
  const response = await googleFetch(accountId, url, init);
  return await response.json() as T;
}

async function listFiles(accountId: string, query: string, fields: string, limit = 100): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(API + "/files");
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "nextPageToken,files(" + fields + ")");
    url.searchParams.set("pageSize", String(Math.min(limit, 1000)));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await apiJSON<DriveList>(accountId, url.toString());
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && files.length < limit);
  return files.slice(0, limit);
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
      body: data,
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
      body,
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
  const files = await listFiles(accountId,
    propertyMatch("immersiveSourceKey", key) +
      " and " + propertyMatch("immersiveFormatKey", "a".repeat(64)).replace(
        " and " + propertyMatch("immersiveFormatKey", "a".repeat(64)), ""),
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

export async function publishDriveDocument(accountId: string, document: LearningDocument, markdown: string): Promise<string> {
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
  };
  let jsonUrl = "";
  for (const format of ["json", "md"] as const) {
    const found = await listFiles(accountId,
      "trashed = false and " + propertyMatch("immersiveDocumentKey",
        // Hash document ID so all query values have a simple, safely escaped alphabet.
        (await import("node:crypto")).createHash("sha256").update(document.id).digest("hex")),
      "id,name,webViewLink,appProperties", 30);
    const existing = found.find(file => file.appProperties?.immersiveFormat === format);
    const name = "Immersive-" + document.id + "." + format;
    const file = existing ?? await uploadFile(accountId, folderId, name,
      format === "json" ? "application/json" : "text/markdown",
      Buffer.from(format === "json" ? JSON.stringify(document, null, 2) + "\n" : markdown, "utf8"),
      { ...properties, immersiveFormat: format,
        immersiveDocumentKey: (await import("node:crypto")).createHash("sha256").update(document.id).digest("hex") });
    if (format === "json") jsonUrl = file.webViewLink ??
      "https://drive.google.com/file/d/" + encodeURIComponent(file.id) + "/view";
  }
  return jsonUrl;
}
