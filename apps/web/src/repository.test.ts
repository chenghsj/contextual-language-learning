import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  captureFavorite,
  FavoriteRecordSchema,
  captureFavoriteCatalog,
  favoriteCollectionBytes,
  favoriteIdentityBytes,
  FAVORITE_CATALOG_KIND,
  type FavoriteSnapshot,
} from "@contextual/core";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture";
import { FavoriteReadRepository } from "./repository";
import { sha256, type FavoriteReadPort } from "./drive";
import type { FavoriteCache, CachedCatalog } from "./cache";
class MemoryCache implements FavoriteCache {
  catalogs = new Map<string, CachedCatalog>();
  contents = new Map<string, FavoriteSnapshot>();
  fail = false;
  async catalog(a: string) {
    return this.catalogs.get(a);
  }
  async saveCatalog(a: string, v: CachedCatalog, valid: () => boolean) {
    if (this.fail) throw new Error("quota");
    if (valid()) this.catalogs.set(a, v);
  }
  async content(a: string, h: string) {
    return this.contents.get(a + h);
  }
  async saveContent(a: string, h: string, v: FavoriteSnapshot, valid: () => boolean) {
    if (this.fail) throw new Error("quota");
    if (valid()) this.contents.set(a + h, v);
  }
  async clear(a: string) {
    this.catalogs.delete(a);
    for (const key of this.contents.keys()) if (key.startsWith(a)) this.contents.delete(key);
  }
}
async function setup() {
  const account = "synthetic-browser",
    document = pointsFixture().document,
    writerId = randomUUID();
  const origin = { documentId: document.id, sceneId: document.sections[0].id };
  const record = FavoriteRecordSchema.parse({
    schemaVersion: 1,
    collectionId: await sha256(favoriteCollectionBytes(account)),
    operationId: randomUUID(),
    origin,
    key: await sha256(favoriteIdentityBytes(origin)),
    writerId,
    version: { [writerId]: 1 },
    createdAt: document.createdAt,
    requestHash: "a".repeat(64),
    action: "add",
    snapshot: captureFavorite(document, origin.sceneId, document.createdAt, "fixture"),
  });
  const source = {
    id: "source",
    operationId: record.operationId,
    hash: await sha256(JSON.stringify(record)),
    schema: "1",
  };
  const catalog = captureFavoriteCatalog(record, source),
    file = {
      id: "catalog",
      operationId: record.operationId,
      hash: await sha256(JSON.stringify(catalog)),
      schema: "1",
    };
  let missing = false,
    wait: Promise<void> | undefined;
  const reads: string[] = [];
  const drive: FavoriteReadPort = {
    async list(_collection, kind) {
      return kind === FAVORITE_CATALOG_KIND ? (missing ? [] : [file]) : [source];
    },
    async read(f) {
      reads.push(f.id);
      await wait;
      return f.id === "source" ? record : catalog;
    },
  };
  const cache = new MemoryCache(),
    repo = new FavoriteReadRepository(account, drive, cache);
  return {
    account,
    record,
    source,
    cache,
    repo,
    reads,
    drive,
    missing: () => (missing = true),
    wait: (value: Promise<void>) => (wait = value),
  };
}
test("listing downloads only catalog; reopening and a new offline instance read cached content", async () => {
  const s = await setup();
  await s.repo.refresh();
  assert.deepEqual(s.reads, ["catalog"]);
  const key = s.repo.list()[0].key;
  await s.repo.get(key);
  assert.deepEqual(s.reads, ["catalog", "source"]);
  const offline = new FavoriteReadRepository(s.account, null, s.cache);
  await offline.hydrate();
  assert.equal(offline.list().length, 1);
  assert.equal((await offline.get(key)).snapshotVersion, 1);
  await assert.rejects(offline.refresh(), /Google Drive/);
});
test("incomplete refresh preserves complete state and quota failure preserves online reading", async () => {
  const s = await setup();
  await s.repo.refresh();
  s.missing();
  await assert.rejects(s.repo.refresh(), /清單不完整/);
  assert.equal(s.repo.list().length, 1);
  s.cache.fail = true;
  await s.repo.get(s.record.key);
  assert.match(s.repo.cacheIssue, /快取/);
});
test("logout during download cannot write data back into a cleared account", async () => {
  const s = await setup();
  await s.repo.refresh();
  let resume!: () => void;
  s.wait(new Promise<void>(resolve => (resume = resolve)));
  const reading = s.repo.get(s.record.key);
  await new Promise(resolve => setTimeout(resolve, 0));
  s.repo.dispose();
  await s.cache.clear(s.account);
  resume();
  await assert.rejects(reading, /Aborted/);
  assert.equal(s.cache.contents.size, 0);
});
test("wrong-account catalogs cannot populate local storage", async () => {
  const s = await setup();
  const wrong = new FavoriteReadRepository("another-account", s.drive, s.cache);
  await assert.rejects(wrong.refresh(), /校驗失敗/);
  assert.deepEqual(wrong.list(), []);
});
