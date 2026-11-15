import {
  CustomDocumentSchema,
  readLearningDocument,
  type LearningDocument,
  type CustomDocument,
} from "@contextual/core";
import { sha256 } from "./drive";

export class MaterialConnectionError extends Error {
  constructor() {
    super("此教材尚未下載，需要連線並連結 Google Drive。");
  }
}

export type LibraryFile = {
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  appProperties: Record<string, string>;
};
export interface LibraryReadPort {
  listLibrary(): Promise<LibraryFile[]>;
  readLibrary(file: LibraryFile, maxBytes: number): Promise<Uint8Array>;
}
export type LibraryItem = {
  key: string;
  documentId: string;
  kind: "standard" | "custom";
  title: string;
  sourceTitle: string;
  language: string;
  createdAt: string;
  schema: string;
  conflict?: boolean;
  json?: LibraryFile;
  markdown?: LibraryFile;
};
export type LibraryDocument =
  | { kind: "standard"; document: LearningDocument; revision: string }
  | {
      kind: "markdown";
      markdown: string;
      document?: CustomDocument;
      sourceUrl?: string;
      legacy: false;
    };
export type LibraryCatalog = { items: LibraryItem[]; updatedAt: string };
export interface LibraryCache {
  libraryDocumentKeys(account: string): Promise<string[]>;
  libraryCatalog(account: string): Promise<LibraryCatalog | undefined>;
  saveLibraryCatalog(account: string, value: LibraryCatalog, valid: () => boolean): Promise<void>;
  libraryDocument(account: string, key: string): Promise<LibraryDocument | undefined>;
  saveLibraryDocument(
    account: string,
    key: string,
    value: LibraryDocument,
    valid: () => boolean,
  ): Promise<void>;
}
const decoder = new TextDecoder("utf-8", { fatal: true });
export function libraryItems(files: LibraryFile[]): LibraryItem[] {
  const groups = new Map<string, LibraryItem>();
  for (const original of files) {
    const p = { ...original.appProperties };
    for (const [key, value] of Object.entries(p))
      if (key.startsWith("immersive")) p["contextual" + key.slice(9)] ??= value;
    const id = p.contextualDocumentId,
      format = p.contextualFormat;
    if (!/^[a-f0-9-]{36}$/i.test(id ?? "") || !["json", "md"].includes(format)) continue;
    const kind =
      p.contextualSchemaVersion === "custom-v1" || p.contextualKind === "custom"
        ? "custom"
        : "standard";
    if (kind === "standard" && p.contextualSchemaVersion !== "7") continue;
    const key = kind + ":" + id;
    const item = groups.get(key) ?? {
      key,
      documentId: id,
      kind,
      title: p.contextualTitle || original.name,
      sourceTitle: p.contextualSourceTitle || "",
      language: p.contextualLanguage || "unspecified",
      createdAt: p.contextualCreatedAt || original.createdTime || "1970-01-01T00:00:00.000Z",
      schema: p.contextualSchemaVersion || "unknown",
    };
    const slot = format === "json" ? "json" : "markdown";
    if (item[slot] && item[slot]!.id !== original.id) item.conflict = true;
    else item[slot] = { ...original, appProperties: p };
    groups.set(key, item);
  }
  return [...groups.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key),
  );
}
export function libraryContentKey(item: LibraryItem): Promise<string> {
  const file = (value: LibraryFile | undefined) =>
    value
      ? [
          value.id,
          value.name,
          value.createdTime ?? null,
          value.modifiedTime ?? null,
          Object.keys(value.appProperties)
            .sort()
            .map(key => [key, value.appProperties[key]]),
        ]
      : null;
  return sha256(JSON.stringify([item.key, file(item.json), file(item.markdown)]));
}
export function legacyLibraryContentKey(item: LibraryItem): Promise<string> {
  return sha256(JSON.stringify([item.key, item.json, item.markdown]));
}
export class DriveLibraryRepository {
  private alive = true;
  private items: LibraryItem[] = [];
  updatedAt: string | null = null;
  cacheIssue = "";
  constructor(
    private account: string,
    private drive: LibraryReadPort | null,
    private cache: LibraryCache,
  ) {}
  dispose() {
    this.alive = false;
  }
  private check() {
    if (!this.alive) throw new DOMException("Aborted", "AbortError");
  }
  async hydrate() {
    try {
      const value = await this.cache.libraryCatalog(this.account);
      this.check();
      if (value) {
        const conflicts = new Set(value.items.filter(item => item.conflict).map(item => item.key));
        this.items = libraryItems(
          value.items.flatMap(item =>
            [item.json, item.markdown].filter((file): file is LibraryFile => !!file),
          ),
        ).map(item => (conflicts.has(item.key) ? { ...item, conflict: true } : item));
        this.updatedAt = value.updatedAt;
      }
    } catch {
      this.check();
      this.cacheIssue = "離線清單無法讀取，目前仍可連線閱讀。";
    }
  }
  list() {
    return this.items;
  }
  async refresh() {
    this.check();
    if (!this.drive) throw new Error("請連結 Google Drive 以更新教材。");
    const next = libraryItems(await this.drive.listLibrary());
    this.check();
    this.items = next;
    this.updatedAt = new Date().toISOString();
    try {
      await this.cache.saveLibraryCatalog(
        this.account,
        { items: next, updatedAt: this.updatedAt },
        () => this.alive,
      );
    } catch {
      this.cacheIssue = "無法保存離線清單，目前仍可連線閱讀。";
    }
    this.check();
  }
  async get(item: LibraryItem): Promise<LibraryDocument> {
    this.check();
    if (item.conflict) throw new Error("這份教材有重複的雲端備份，請在原裝置確認後重試。");
    const key = await libraryContentKey(item);
    try {
      const cached =
        (await this.cache.libraryDocument(this.account, key)) ??
        (await this.cache.libraryDocument(this.account, await legacyLibraryContentKey(item)));
      this.check();
      if (cached) {
        if (cached.kind === "standard") {
          const document = readLearningDocument(cached.document);
          if (document.id !== item.documentId) throw new Error("Cached document identity mismatch");
        } else if (
          item.kind !== "custom" ||
          cached.kind !== "markdown" ||
          typeof cached.markdown !== "string" ||
          !cached.markdown.length
        )
          throw new Error("Invalid cached content");
        const enrichSource =
          cached.kind === "markdown" &&
          !cached.document &&
          this.drive &&
          globalThis.navigator?.onLine !== false;
        if (!enrichSource) {
          await this.cache
            .saveLibraryDocument(this.account, key, cached, () => this.alive)
            .catch(() => {});
          this.check();
          return cached;
        }
      }
    } catch {
      this.check();
    }
    if (!this.drive || globalThis.navigator?.onLine === false) throw new MaterialConnectionError();
    const read = async (file: LibraryFile) => {
      const bytes = await this.drive!.readLibrary(file, 25_000_000);
      this.check();
      const hash = file.appProperties.contextualContentHash;
      if (hash && (await sha256(bytes)) !== hash) throw new Error("教材校驗失敗，已保留原資料。");
      return decoder.decode(bytes);
    };
    let result: LibraryDocument;
    if (item.kind === "custom") {
      if (!item.json || !item.markdown) throw new Error("自訂教材備份尚未完整，請先在原裝置同步。");
      if (
        !item.json.appProperties.contextualContentHash ||
        !item.markdown.appProperties.contextualContentHash
      )
        throw new Error("自訂教材缺少校驗資訊，請在原裝置重新備份。");
      const json = JSON.parse(await read(item.json)),
        markdown = await read(item.markdown);
      if (json.markdownHash !== (await sha256(markdown)))
        throw new Error("自訂教材內容與備份資訊不一致。");
      const document = CustomDocumentSchema.parse({ ...json, markdown });
      if (document.id !== item.documentId) throw new Error("自訂教材識別不一致。");
      result = {
        kind: "markdown",
        markdown: document.markdown,
        document,
        sourceUrl: document.request.source.url,
        legacy: false,
      };
    } else {
      if (!item.json) throw new Error("JSON 教材備份不完整，請從 Extension 重新備份。");
      const document = readLearningDocument(JSON.parse(await read(item.json)));
      if (document.id !== item.documentId) throw new Error("教材識別不一致。");
      result = { kind: "standard", document, revision: key };
    }
    this.check();
    try {
      await this.cache.saveLibraryDocument(this.account, key, result, () => this.alive);
    } catch {
      this.cacheIssue = "無法保存離線副本；目前仍可連線閱讀。";
    }
    this.check();
    return result;
  }
}
