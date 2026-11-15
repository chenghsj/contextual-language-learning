import test from "node:test";
import assert from "node:assert/strict";
import {
  captureFavorite,
  captureCustomFavorite,
  type FavoriteRecord,
  type FavoriteCatalogOperation,
} from "@contextual/core";
import { BrowserFavorites, type PendingFavorite, type FavoriteWritePort } from "./favorite-writer";
import { FavoriteReadRepository } from "./repository";
import { sha256 } from "./drive";
import { libraryFixture } from "./library-fixture";
import type { FavoriteCache, FavoriteMutationCache, CachedCatalog } from "./cache";
class Cache implements FavoriteCache, FavoriteMutationCache {
  indexes = new Map<string, CachedCatalog>();
  contentRows = new Map<string, unknown>();
  jobs = new Map<string, PendingFavorite>();
  async catalog(account: string) {
    return this.indexes.get(account);
  }
  async saveCatalog(account: string, value: CachedCatalog, valid: () => boolean) {
    if (valid()) this.indexes.set(account, structuredClone(value));
  }
  async content() {
    return undefined;
  }
  async saveContent() {}
  async pendingFavorites(account: string) {
    return [...this.jobs.entries()]
      .filter(([key]) => key.startsWith(account + ":"))
      .map(([, job]) => structuredClone(job));
  }
  async savePendingFavorite(account: string, value: PendingFavorite, valid: () => boolean) {
    if (valid()) this.jobs.set(account + ":" + value.record.operationId, structuredClone(value));
  }
  async removePendingFavorite(account: string, id: string) {
    this.jobs.delete(account + ":" + id);
  }
  async clear(account: string) {
    this.indexes.delete(account);
    for (const key of this.jobs.keys()) if (key.startsWith(account + ":")) this.jobs.delete(key);
  }
}
function remote() {
  const files = new Map<
    string,
    { kind: string; collection: string; record: FavoriteRecord | FavoriteCatalogOperation }
  >();
  let failCatalog = false;
  const drive: FavoriteWritePort = {
    async reserve() {
      return crypto.randomUUID();
    },
    async writeFavorite(collection, record, id, kind) {
      if (failCatalog && kind === "favorite-catalog-operation")
        throw new Error("synthetic catalog failure");
      const existing = files.get(id);
      if (existing) assert.deepEqual(existing, { kind, collection, record });
      else files.set(id, { kind, collection, record: structuredClone(record) });
    },
    async list(collection, kind) {
      return Promise.all(
        [...files]
          .filter(([, file]) => file.kind === kind && file.collection === collection)
          .map(async ([id, file]) => ({
            id,
            operationId: file.record.operationId,
            hash: await sha256(JSON.stringify(file.record)),
            schema: "1",
          })),
      );
    },
    async read(file) {
      return structuredClone(files.get(file.id)!.record);
    },
  };
  return {
    drive,
    files,
    fail: (value: boolean) => {
      failCatalog = value;
    },
  };
}
test("web writes standard and custom favorites in the Desktop immutable operation/catalog format", async () => {
  const f = await libraryFixture(),
    cache = new Cache(),
    cloud = remote();
  const repo = new FavoriteReadRepository("account", cloud.drive, cache),
    store = new BrowserFavorites("account", repo, cloud.drive, cache);
  const origin = { documentId: f.document.id, sceneId: f.document.sections[0].id };
  await store.set(origin, true, at => captureFavorite(f.document, origin.sceneId, at, "revision"));
  assert.equal(repo.list().length, 1);
  const custom = { documentId: f.custom.id, sceneId: f.custom.id };
  await store.set(custom, true, at => captureCustomFavorite(f.custom, at, "revision"));
  assert.equal(repo.list().length, 2);
  const desktopReader = new FavoriteReadRepository("account", cloud.drive, new Cache());
  await desktopReader.refresh();
  assert.equal(desktopReader.list().length, 2);
  assert.equal(
    (await desktopReader.get(repo.list().find(item => item.documentId === f.custom.id)!.key))
      .snapshotVersion,
    2,
  );
  await store.set(origin, false);
  await desktopReader.refresh();
  assert.equal(desktopReader.list().length, 1);
  await store.set(origin, false);
  assert.equal(
    cloud.files.size,
    6,
    "repeating the desired state does not create duplicate operations",
  );
  assert.equal((await cache.pendingFavorites("account")).length, 0);
  const other = new FavoriteReadRepository("other", cloud.drive, new Cache());
  await other.refresh();
  assert.equal(other.list().length, 0);
});
test("a failed catalog upload survives reload and retries with the same reserved IDs", async () => {
  const f = await libraryFixture(),
    cache = new Cache(),
    cloud = remote();
  cloud.fail(true);
  const repo = new FavoriteReadRepository("account", cloud.drive, cache),
    store = new BrowserFavorites("account", repo, cloud.drive, cache);
  const origin = { documentId: f.document.id, sceneId: f.document.sections[0].id };
  await assert.rejects(
    store.set(origin, true, at => captureFavorite(f.document, origin.sceneId, at, "revision")),
    /catalog failure/,
  );
  const pending = await cache.pendingFavorites("account");
  assert.equal(pending.length, 1);
  assert.equal(cloud.files.size, 1);
  store.dispose();
  cloud.fail(false);
  const restored = new BrowserFavorites(
    "account",
    new FavoriteReadRepository("account", cloud.drive, cache),
    cloud.drive,
    cache,
  );
  await restored.refresh();
  assert.equal(cloud.files.size, 2);
  assert.ok(cloud.files.has(pending[0].sourceId));
  assert.ok(cloud.files.has(pending[0].catalogId));
  assert.equal(restored.getSnapshot().items.length, 1);
});
test("verified orphan operations can repair their missing catalog after local pending state is cleared", async () => {
  const f = await libraryFixture(),
    cache = new Cache(),
    cloud = remote();
  cloud.fail(true);
  const origin = { documentId: f.document.id, sceneId: f.document.sections[0].id };
  const first = new BrowserFavorites(
    "account",
    new FavoriteReadRepository("account", cloud.drive, cache),
    cloud.drive,
    cache,
  );
  await assert.rejects(
    first.set(origin, true, at => captureFavorite(f.document, origin.sceneId, at, "revision")),
  );
  first.dispose();
  await cache.clear("account");
  cloud.fail(false);
  const next = new BrowserFavorites(
    "account",
    new FavoriteReadRepository("account", cloud.drive, cache),
    cloud.drive,
    cache,
  );
  await next.refresh();
  assert.equal(next.getSnapshot().items.length, 1);
  assert.equal(cloud.files.size, 2);
});
