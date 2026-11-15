import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FavoriteRecord,
  type FavoriteCatalogOperation,
  verifyFavoriteCatalogCoverage,
} from "@contextual/core";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { createFavoritesService } from "../favorites/service";
function memoryDrive<T extends { operationId: string }>() {
  const files = new Map<string, { collection: string; account: string; record: T }>();
  let fail = false;
  return {
    files,
    failNext: () => {
      fail = true;
    },
    async list(account: string, collection: string) {
      return [...files]
        .filter(([, f]) => f.collection === collection && f.account === account)
        .map(([id, f]) => ({
          id,
          operationId: f.record.operationId,
          hash: createHash("sha256").update(JSON.stringify(f.record)).digest("hex"),
          schema: "1",
        }));
    },
    async read(_account: string, _collection: string, file: { id: string }) {
      return structuredClone(files.get(file.id)!.record);
    },
    async reserve() {
      return randomUUID();
    },
    async write(account: string, collection: string, record: T, id: string) {
      files.set(id, { account, collection, record: structuredClone(record) });
      if (fail) {
        fail = false;
        throw new Error("network failed after catalog commit");
      }
    },
  };
}
test("desktop backfills old records and retries interrupted catalog publication without duplicating files", async () => {
  const root = await mkdtemp(join(tmpdir(), "favorite-catalog-")),
    fixture = pointsFixture();
  const drive = memoryDrive<FavoriteRecord>(),
    catalog = memoryDrive<FavoriteCatalogOperation>();
  const collection = { kind: "account" as const, accountId: "synthetic" };
  const options = { root, drive, loadDocument: async () => fixture.document };
  const old = createFavoritesService(options);
  await old.configure({
    kind: "enable",
    accountId: collection.accountId,
    importLocal: false,
    mutationId: randomUUID(),
  });
  const input = {
    documentId: fixture.document.id,
    sceneId: fixture.document.sections[0].id,
    collection,
    mutationId: randomUUID(),
    desired: true,
  };
  await old.set(input);
  assert.equal((await old.sync(collection)).state, "synced");
  const service = createFavoritesService({ ...options, catalog });
  catalog.failNext();
  assert.notEqual((await service.sync(collection)).state, "synced");
  assert.equal((await service.list(collection, { limit: 40 })).items.length, 1);
  assert.equal((await service.sync(collection)).state, "synced");
  assert.equal(drive.files.size, 1);
  assert.equal(catalog.files.size, 1);
  await service.set({ ...input, mutationId: randomUUID(), desired: false });
  assert.equal((await service.sync(collection)).state, "synced");
  const id = [...drive.files.values()][0].collection;
  const projected = [...catalog.files.values()].map(f => f.record);
  assert.equal(
    verifyFavoriteCatalogCoverage(await drive.list(collection.accountId, id), projected, id).length,
    2,
  );
  assert.equal(projected.filter(r => r.action === "remove").length, 1);
});
