import {
  FAVORITE_MAX_BYTES,
  FAVORITE_CATALOG_MAX_BYTES,
  FAVORITE_CATALOG_KIND,
  FAVORITE_OPERATION_KIND,
  FavoriteCatalogOperationSchema,
  FavoriteRecordSchema,
  parseFavoriteSnapshot,
  catalogWinners,
  verifyFavoriteCatalogCoverage,
  favoriteCollectionBytes,
  favoriteIdentityBytes,
  captureFavoriteCatalog,
  type FavoriteCatalogOperation,
  type FavoriteSnapshot,
  type FavoriteSummary,
} from "@contextual/core";
import { sha256, type FavoriteReadPort } from "./drive";
import type { FavoriteCache } from "./cache";
export class FavoriteReadRepository {
  private alive = true;
  private records: FavoriteCatalogOperation[] = [];
  updatedAt: string | null = null;
  cacheIssue = "";
  constructor(
    readonly accountId: string,
    private drive: FavoriteReadPort | null,
    private cache: FavoriteCache,
    private namespace = "favorites-v1",
  ) {}
  dispose() {
    this.alive = false;
  }
  private check() {
    if (!this.alive) throw new DOMException("Aborted", "AbortError");
  }
  async hydrate() {
    try {
      const cached = await this.cache.catalog(this.accountId);
      this.check();
      if (cached) {
        this.records = cached.records.map(r => FavoriteCatalogOperationSchema.parse(r));
        this.updatedAt = cached.updatedAt;
      }
    } catch (e) {
      this.check();
      this.cacheIssue = "無法讀取離線快取，可重新連結 Drive 讀取。";
    }
  }
  async refresh() {
    this.check();
    if (!this.drive) throw new Error("請連結 Google Drive 以更新收藏。");
    const collection = await sha256(favoriteCollectionBytes(this.accountId, this.namespace));
    const [sources, files] = await Promise.all([
      this.drive.list(collection, FAVORITE_OPERATION_KIND),
      this.drive.list(collection, FAVORITE_CATALOG_KIND),
    ]);
    this.check();
    const existing = new Map(this.records.map(r => [r.operationId, r]));
    const records: FavoriteCatalogOperation[] = [];
    for (const file of files) {
      this.check();
      if (file.schema !== "1") throw new Error("收藏索引格式較新，請更新網站。");
      let record = existing.get(file.operationId);
      if (!record || (await sha256(JSON.stringify(record))) !== file.hash)
        record = FavoriteCatalogOperationSchema.parse(
          await this.drive.read(file, FAVORITE_CATALOG_MAX_BYTES),
        );
      if (
        record.operationId !== file.operationId ||
        record.key !== (await sha256(favoriteIdentityBytes(record.origin))) ||
        (await sha256(JSON.stringify(record))) !== file.hash
      )
        throw new Error("收藏索引識別或校驗失敗。");
      records.push(record);
    }
    // A second inventory catches writes/removals during a slow initial catalog download.
    const after = await this.drive.list(collection, FAVORITE_OPERATION_KIND);
    const inventory = (values: typeof sources) =>
      values
        .map(f => [f.id, f.operationId, f.hash, f.schema].join(":"))
        .sort()
        .join("\n");
    if (inventory(sources) !== inventory(after)) throw new Error("雲端收藏正在更新，請重新整理。");
    let complete: FavoriteCatalogOperation[];
    try {
      complete = verifyFavoriteCatalogCoverage(after, records, collection);
    } catch (cause) {
      throw new Error("雲端收藏清單不完整或校驗失敗。請先在原裝置同步收藏，再重新整理。", {
        cause,
      });
    }
    this.check();
    this.records = complete;
    this.updatedAt = new Date().toISOString();
    try {
      await this.cache.saveCatalog(
        this.accountId,
        { records: complete, updatedAt: this.updatedAt },
        () => this.alive,
      );
    } catch {
      this.cacheIssue = "無法保存離線清單，目前仍可連線閱讀。";
    }
    this.check();
  }
  list(search = "", language = ""): FavoriteSummary[] {
    const term = search.trim().toLocaleLowerCase();
    return catalogWinners(this.records)
      .map(r => ({ ...r.summary, pending: false }))
      .filter(
        item =>
          (!language || item.language === language) &&
          (!term ||
            [item.title, item.sourceTitle, item.excerpt]
              .join(" ")
              .toLocaleLowerCase()
              .includes(term)),
      );
  }
  operations() {
    return this.records.slice();
  }
  async get(key: string): Promise<FavoriteSnapshot> {
    this.check();
    const record = catalogWinners(this.records).find(r => r.key === key);
    if (!record) throw new Error("此收藏已取消或目前清單尚未同步。");
    try {
      const cached = await this.cache.content(this.accountId, record.source.hash);
      this.check();
      if (cached) {
        const snapshot = parseFavoriteSnapshot(cached);
        if (
          snapshot.origin.documentId !== record.origin.documentId ||
          snapshot.origin.sceneId !== record.origin.sceneId
        )
          throw new Error("快取識別無效。");
        try {
          await this.cache.saveContent(
            this.accountId,
            record.source.hash,
            snapshot,
            () => this.alive,
          );
        } catch {
          this.cacheIssue = "無法更新離線快取。";
        }
        this.check();
        return snapshot;
      }
    } catch {
      this.check();
      this.cacheIssue = "離線快取無法讀取，將嘗試從 Drive 下載。";
    }
    if (!this.drive || globalThis.navigator?.onLine === false)
      throw new Error("此教材尚未下載，需要連線並連結 Google Drive。 ");
    const input = await this.drive.read(
      { ...record.source, operationId: record.operationId, schema: "1" },
      FAVORITE_MAX_BYTES,
    );
    this.check();
    const original = FavoriteRecordSchema.parse(input);
    if (
      original.action !== "add" ||
      original.operationId !== record.operationId ||
      original.collectionId !== record.collectionId ||
      original.key !== key ||
      (await sha256(JSON.stringify(original))) !== record.source.hash
    )
      throw new Error("收藏內容與清單不一致，原資料已保留。");
    if (JSON.stringify(captureFavoriteCatalog(original, record.source)) !== JSON.stringify(record))
      throw new Error("收藏內容與索引不一致。");
    const snapshot = parseFavoriteSnapshot(original.snapshot);
    try {
      await this.cache.saveContent(this.accountId, record.source.hash, snapshot, () => this.alive);
    } catch {
      this.cacheIssue = "空間不足或快取不可用；此教材尚未保存離線副本。";
    }
    this.check();
    return snapshot;
  }
}
