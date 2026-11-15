import {
  FavoriteRecordSchema,
  parseFavoriteSnapshot,
  nextFavoriteVersion,
  captureFavoriteCatalog,
  favoriteCollectionBytes,
  favoriteIdentityBytes,
  FAVORITE_MAX_BYTES,
  type FavoriteRecord,
  type FavoriteCatalogOperation,
  type FavoriteIdentity,
  type FavoriteSnapshot,
  type FavoriteSummary,
} from "@contextual/core";
import type { FavoriteReadRepository } from "./repository";
import type { FavoriteCache, FavoriteMutationCache } from "./cache";
import { sha256, type FavoriteReadPort } from "./drive";
export interface FavoriteWritePort extends FavoriteReadPort {
  reserve(): Promise<string>;
  writeFavorite(
    collection: string,
    record: FavoriteRecord | FavoriteCatalogOperation,
    id: string,
    kind: "favorite-operation" | "favorite-catalog-operation",
  ): Promise<void>;
}
export type PendingFavorite = {
  record: FavoriteRecord;
  sourceId: string;
  catalogId: string;
  catalog: FavoriteCatalogOperation;
};
export class BrowserFavorites {
  private alive = true;
  private writer = crypto.randomUUID();
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private value: { items: FavoriteSummary[]; pending: ReadonlySet<string>; error: string } = {
    items: [],
    pending: new Set(),
    error: "",
  };
  constructor(
    readonly account: string,
    private repo: FavoriteReadRepository,
    private drive: FavoriteWritePort | null,
    private cache: FavoriteCache & FavoriteMutationCache,
    private namespace = "favorites-v1",
  ) {}
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = () => this.value;
  get writable() {
    return !!this.drive && globalThis.navigator?.onLine !== false;
  }
  dispose() {
    this.alive = false;
  }
  private check() {
    if (!this.alive) throw new DOMException("Aborted", "AbortError");
  }
  private emit(error = "", pending = this.value.pending) {
    this.check();
    this.value = { items: this.repo.list(), pending, error };
    this.listeners.forEach(listener => listener());
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(work);
    this.queue = result;
    return result;
  }
  private async flush() {
    const jobs = await this.cache.pendingFavorites(this.account);
    this.check();
    this.emit("", new Set(jobs.map(job => job.record.key)));
    if (jobs.length && !this.drive) throw new Error("連結 Google Drive 後才能同步收藏。");
    for (const job of jobs) {
      const record = FavoriteRecordSchema.parse(job.record);
      this.check();
      const collection = await sha256(favoriteCollectionBytes(this.account, this.namespace));
      if (
        record.collectionId !== collection ||
        record.key !== (await sha256(favoriteIdentityBytes(record.origin)))
      )
        throw new Error("待同步收藏識別不一致。");
      const hash = await sha256(JSON.stringify(record));
      const expected = captureFavoriteCatalog(record, { id: job.sourceId, hash });
      if (JSON.stringify(expected) !== JSON.stringify(job.catalog))
        throw new Error("待同步收藏索引校驗失敗。");
      await this.drive!.writeFavorite(collection, record, job.sourceId, "favorite-operation");
      this.check();
      await this.drive!.writeFavorite(
        collection,
        job.catalog,
        job.catalogId,
        "favorite-catalog-operation",
      );
      this.check();
      await this.cache.removePendingFavorite(this.account, record.operationId);
      this.check();
    }
    this.emit("", new Set());
  }
  private async refreshRemote() {
    try {
      await this.repo.refresh();
    } catch (error) {
      if (!this.drive || !(error instanceof Error) || !error.message.includes("清單不完整"))
        throw error;
      const collection = await sha256(favoriteCollectionBytes(this.account, this.namespace));
      const [sources, indexes] = await Promise.all([
        this.drive.list(collection, "favorite-operation"),
        this.drive.list(collection, "favorite-catalog-operation"),
      ]);
      const known = new Set(indexes.map(file => file.operationId));
      const missing = sources.filter(file => !known.has(file.operationId));
      if (!missing.length) throw error;
      for (const source of missing) {
        if (source.schema !== "1") throw error;
        const record = FavoriteRecordSchema.parse(
          await this.drive.read(source, FAVORITE_MAX_BYTES),
        );
        this.check();
        if (
          record.collectionId !== collection ||
          record.operationId !== source.operationId ||
          (await sha256(JSON.stringify(record))) !== source.hash ||
          record.key !== (await sha256(favoriteIdentityBytes(record.origin)))
        )
          throw new Error("收藏修復校驗失敗。");
        const catalogId = await this.drive.reserve();
        this.check();
        const catalog = captureFavoriteCatalog(record, { id: source.id, hash: source.hash });
        await this.cache.savePendingFavorite(
          this.account,
          { record, sourceId: source.id, catalogId, catalog },
          () => this.alive,
        );
        this.check();
      }
      await this.flush();
      await this.repo.refresh();
    }
  }
  refresh() {
    return this.serial(async () => {
      try {
        await this.flush();
        if (this.drive) await this.refreshRemote();
        this.emit();
      } catch (cause) {
        if (this.alive) this.emit(cause instanceof Error ? cause.message : "收藏同步失敗");
        throw cause;
      }
    });
  }
  set(origin: FavoriteIdentity, desired: boolean, snapshot?: (at: string) => FavoriteSnapshot) {
    return this.serial(async () => {
      this.check();
      if (desired && !snapshot) throw new Error("收藏內容尚未載入。");
      if (!this.writable) throw new Error("請連線並連結 Google Drive 後再變更收藏。");
      try {
        await this.flush();
        await this.refreshRemote();
        this.check();
        const key = await sha256(favoriteIdentityBytes(origin));
        if (this.repo.list().some(item => item.key === key) === desired) {
          this.emit();
          return;
        }
        const at = new Date().toISOString();
        const record = FavoriteRecordSchema.parse({
          schemaVersion: 1,
          operationId: crypto.randomUUID(),
          collectionId: await sha256(favoriteCollectionBytes(this.account, this.namespace)),
          key,
          origin,
          writerId: this.writer,
          version: nextFavoriteVersion(
            this.repo.operations().filter(record => record.key === key),
            this.writer,
          ),
          createdAt: at,
          requestHash: await sha256(JSON.stringify({ origin, desired, at })),
          action: desired ? "add" : "remove",
          ...(desired ? { snapshot: parseFavoriteSnapshot(snapshot!(at)) } : {}),
        });
        const bytes = new TextEncoder().encode(JSON.stringify(record));
        if (bytes.length > FAVORITE_MAX_BYTES) throw new Error("收藏內容超過儲存上限。");
        const [sourceId, catalogId] = await Promise.all([
          this.drive!.reserve(),
          this.drive!.reserve(),
        ]);
        this.check();
        const catalog = captureFavoriteCatalog(record, { id: sourceId, hash: await sha256(bytes) });
        await this.cache.savePendingFavorite(
          this.account,
          { record, sourceId, catalogId, catalog },
          () => this.alive,
        );
        this.check();
        await this.flush();
        await this.refreshRemote();
        this.emit();
      } catch (cause) {
        if (this.alive) this.emit(cause instanceof Error ? cause.message : "收藏同步失敗");
        throw cause;
      }
    });
  }
}
