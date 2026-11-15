import {
  FAVORITE_CATALOG_KIND,
  FAVORITE_OPERATION_KIND,
  type FavoriteFileReference,
} from "@contextual/core";
import type { FavoriteWritePort } from "./favorite-writer";
import type { LibraryReadPort, LibraryFile } from "./library";
export type CatalogFile = FavoriteFileReference;
export interface FavoriteReadPort {
  list(
    collectionId: string,
    kind: typeof FAVORITE_CATALOG_KIND | typeof FAVORITE_OPERATION_KIND,
  ): Promise<CatalogFile[]>;
  read(file: CatalogFile, maxBytes: number): Promise<unknown>;
}
export class DriveAccessError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? "Google 授權已過期，請重新連結。"
        : status === 403
          ? "Google Drive 拒絕存取。請確認帳號、授權與配額。"
          : status === 404
            ? "雲端收藏檔案已不存在。"
            : "Google Drive 暫時無法讀取，請稍後重試。",
    );
  }
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const result = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return [...new Uint8Array(result)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const API = "https://www.googleapis.com/drive/v3/files";
export function createBrowserDrive(
  token: string,
  signal: AbortSignal,
  onUnauthorized?: () => void,
): FavoriteWritePort & LibraryReadPort {
  async function readResponse(
    url: string,
    init: RequestInit = {},
    retry = true,
    acceptIncomplete = false,
  ) {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", "Bearer " + token);
      const response = await fetch(url, {
        ...init,
        headers,
        signal,
        cache: "no-store",
        credentials: "omit",
      });
      if (response.ok || (acceptIncomplete && response.status === 308)) return response;
      if (retry && attempt < 3 && (response.status === 429 || response.status >= 500)) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          const timer = setTimeout(
            () => {
              signal.removeEventListener("abort", abort);
              resolve();
            },
            500 * 2 ** attempt + Math.random() * 250,
          );
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        continue;
      }
      if (response.status === 401) onUnauthorized?.();
      throw new DriveAccessError(response.status);
    }
  }
  async function readBytes(id: string, maxBytes: number) {
    const response = await readResponse(API + "/" + encodeURIComponent(id) + "?alt=media");
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes || !response.body)
      throw new Error("檔案超過讀取上限。");
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > maxBytes) throw new Error("檔案超過讀取上限。");
        parts.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }
  let folders: Promise<Record<string, string>> | undefined;
  const reserve = async () => {
    const result = await (
      await readResponse(API + "/generateIds?count=1&space=drive&type=files")
    ).json();
    if (!Array.isArray(result.ids) || typeof result.ids[0] !== "string")
      throw new Error("Google Drive 未提供檔案識別。");
    return result.ids[0] as string;
  };
  async function favoriteFolders() {
    return (folders ??= (async () => {
      const result: Record<string, string> = {};
      let parent: string | undefined;
      for (const name of ["AI-powered Contextual Language Learning", "Favorites"]) {
        const url = new URL(API);
        url.searchParams.set(
          "q",
          `trashed=false and mimeType='application/vnd.google-apps.folder' and name='${name}'${parent ? ` and '${parent}' in parents` : ""}`,
        );
        url.searchParams.set("fields", "files(id)");
        const found = await (await readResponse(url.toString())).json();
        if (found.files?.[0]?.id) parent = found.files[0].id;
        else {
          const id = await reserve();
          const created = await readResponse(
            API + "?fields=id",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id,
                name,
                mimeType: "application/vnd.google-apps.folder",
                ...(parent ? { parents: [parent] } : {}),
              }),
            },
            false,
          );
          parent = (await created.json()).id;
        }
      }
      if (!parent) throw new Error("收藏資料夾無法建立。");
      for (const name of ["operations", "catalog"]) {
        const url = new URL(API);
        url.searchParams.set(
          "q",
          `trashed=false and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name}'`,
        );
        url.searchParams.set("fields", "files(id)");
        const found = await (await readResponse(url.toString())).json();
        if (found.files?.[0]?.id) result[name] = found.files[0].id;
        else {
          const id = await reserve();
          const created = await readResponse(
            API + "?fields=id",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id,
                name,
                mimeType: "application/vnd.google-apps.folder",
                parents: [parent],
              }),
            },
            false,
          );
          result[name] = (await created.json()).id;
        }
      }
      return result;
    })().catch(error => {
      folders = undefined;
      throw error;
    }));
  }
  return {
    reserve,
    async writeFavorite(collection, record, id, kind) {
      if (!/^[a-f0-9]{64}$/.test(collection) || record.collectionId !== collection)
        throw new Error("收藏集合識別無效。");
      const text = JSON.stringify(record),
        hash = await sha256(text);
      const folder = (await favoriteFolders())[
        kind === "favorite-operation" ? "operations" : "catalog"
      ];
      const metadata = {
        id,
        name: record.operationId + ".favorite.json",
        mimeType: "application/json",
        parents: [folder],
        appProperties: {
          contextualKind: kind,
          contextualFavoriteCollection: collection,
          contextualFavoriteOperation: record.operationId,
          contextualFavoriteSchema: "1",
          contextualContentHash: hash,
        },
      };
      const boundary = "favorite_" + crypto.randomUUID().replaceAll("-", "");
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--\r\n`;
      try {
        const bytes = new TextEncoder().encode(text);
        if (bytes.length <= 5 * 1024 * 1024) {
          await readResponse(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
            {
              method: "POST",
              headers: { "Content-Type": "multipart/related; boundary=" + boundary },
              body,
            },
          );
        } else {
          const session = await readResponse(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": "application/json",
                "X-Upload-Content-Length": String(bytes.length),
              },
              body: JSON.stringify(metadata),
            },
          );
          const location = new URL(session.headers.get("Location") ?? "");
          if (
            location.origin !== "https://www.googleapis.com" ||
            location.pathname !== "/upload/drive/v3/files" ||
            location.username ||
            location.password
          )
            throw new Error("Google Drive 上傳位置無效。");
          let offset = 0;
          for (let attempt = 0; attempt < 4; attempt++) {
            let response: Response;
            try {
              response = await readResponse(
                location.href,
                {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    "Content-Range": `bytes ${offset}-${bytes.length - 1}/${bytes.length}`,
                  },
                  body: bytes.slice(offset),
                },
                false,
                true,
              );
            } catch (error) {
              if (
                signal.aborted ||
                (error instanceof DriveAccessError && error.status < 500 && error.status !== 429)
              )
                throw error;
              response = await readResponse(
                location.href,
                {
                  method: "PUT",
                  headers: { "Content-Range": `bytes */${bytes.length}` },
                  body: new Uint8Array(),
                },
                true,
                true,
              );
            }
            if (response.ok) break;
            const range = /^bytes=0-(\d+)$/.exec(response.headers.get("Range") ?? "");
            const next = range ? Number(range[1]) + 1 : 0;
            if (!Number.isSafeInteger(next) || next < offset || next >= bytes.length)
              throw new Error("Google Drive 上傳進度無效，請重試。");
            offset = next;
            if (attempt === 3) throw new Error("Google Drive 上傳未完成，請重試同步。");
          }
        }
      } catch (error) {
        if (!(error instanceof DriveAccessError) || error.status !== 409) throw error;
        const existing = await (
          await readResponse(
            API + "/" + encodeURIComponent(id) + "?fields=id,appProperties,trashed",
          )
        ).json();
        const p = existing.appProperties;
        if (
          existing.trashed ||
          p?.contextualKind !== kind ||
          p?.contextualFavoriteCollection !== collection ||
          p?.contextualFavoriteOperation !== record.operationId ||
          p?.contextualContentHash !== hash ||
          (await sha256(await readBytes(id, new TextEncoder().encode(text).length))) !== hash
        )
          throw new Error("雲端收藏檔案已存在且內容不一致，未覆寫。");
      }
    },
    async listLibrary() {
      const files: LibraryFile[] = [],
        tokens = new Set<string>();
      let next: string | undefined;
      do {
        const url = new URL(API);
        const formats = ["contextualFormat", "immersiveFormat"].flatMap(key =>
          ["json", "md"].map(value => `appProperties has { key='${key}' and value='${value}' }`),
        );
        url.searchParams.set("q", "trashed = false and (" + formats.join(" or ") + ")");
        url.searchParams.set(
          "fields",
          "files(id,name,createdTime,modifiedTime,appProperties),nextPageToken,incompleteSearch",
        );
        url.searchParams.set("pageSize", "1000");
        if (next) url.searchParams.set("pageToken", next);
        const page = await (await readResponse(url.toString())).json();
        if (page.incompleteSearch || !Array.isArray(page.files))
          throw new Error("Google Drive 教材清單不完整，請重試。");
        for (const file of page.files) {
          if (
            typeof file.id !== "string" ||
            typeof file.name !== "string" ||
            !file.appProperties ||
            Object.values(file.appProperties).some(value => typeof value !== "string")
          )
            throw new Error("雲端教材備份資訊無效。");
          files.push(file);
        }
        next = page.nextPageToken;
        if (next && (typeof next !== "string" || tokens.has(next)))
          throw new Error("Google Drive 分頁無效。");
        if (next) tokens.add(next);
      } while (next);
      return files;
    },
    readLibrary: (file, maxBytes) => readBytes(file.id, maxBytes),
    async list(collectionId, kind) {
      if (!/^[a-f0-9]{64}$/.test(collectionId)) throw new Error("Invalid collection");
      const files: CatalogFile[] = [],
        tokens = new Set<string>();
      let token: string | undefined;
      do {
        const url = new URL(API);
        url.searchParams.set(
          "q",
          `trashed = false and appProperties has { key='contextualKind' and value='${kind}' } and appProperties has { key='contextualFavoriteCollection' and value='${collectionId}' }`,
        );
        url.searchParams.set("fields", "files(id,appProperties),nextPageToken,incompleteSearch");
        url.searchParams.set("pageSize", "1000");
        if (token) url.searchParams.set("pageToken", token);
        const page = await (await readResponse(url.toString())).json();
        if (page.incompleteSearch || !Array.isArray(page.files))
          throw new Error("Drive 收藏清單不完整，請重試。");
        for (const file of page.files) {
          const p = file.appProperties ?? {};
          if (
            p.contextualKind !== kind ||
            p.contextualFavoriteCollection !== collectionId ||
            typeof file.id !== "string" ||
            !/^[a-f0-9]{64}$/.test(p.contextualContentHash ?? "") ||
            !/^[a-f0-9-]{36}$/i.test(p.contextualFavoriteOperation ?? "")
          )
            throw new Error("雲端收藏識別無效。");
          files.push({
            id: file.id,
            operationId: p.contextualFavoriteOperation,
            hash: p.contextualContentHash,
            schema: p.contextualFavoriteSchema ?? "unknown",
          });
        }
        token = page.nextPageToken;
        if (token && (typeof token !== "string" || tokens.has(token)))
          throw new Error("Drive 分頁無效。");
        if (token) tokens.add(token);
      } while (token);
      return files;
    },
    async read(file, maxBytes) {
      const bytes = await readBytes(file.id, maxBytes);
      if ((await sha256(bytes)) !== file.hash) throw new Error("收藏檔案校驗失敗，原資料已保留。");
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    },
  };
}
