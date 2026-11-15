import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FAVORITE_CATALOG_KIND,
  customFavoriteTarget,
  type FavoriteSnapshot,
} from "@contextual/core";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture";
import { customFavoriteFixture } from "../../../packages/core/test/custom-favorite-fixture";
import { listGoogleAccounts } from "../src/drive/oauth";
import { googleFetch } from "../src/drive/api";
import { createFavoriteDrive, createFavoriteCatalogDrive } from "../src/drive/favorites";
import { createFavoritesService, favoriteCollectionId } from "../src/favorites/service";
import { FavoriteReadRepository } from "../../web/src/repository";
import type { CachedCatalog, FavoriteCache } from "../../web/src/cache";
const account = (await listGoogleAccounts()).find(a => a.email === process.argv[2]);
if (!account) throw new Error("Selected Google test account is not connected");
const namespace = "favorites-web-verification-" + randomUUID();
const collection = { kind: "account" as const, accountId: account.id },
  collectionId = favoriteCollectionId(collection, namespace);
const drive = createFavoriteDrive(),
  catalog = createFavoriteCatalogDrive();
const document = pointsFixture().document,
  custom = customFavoriteFixture();
document.source.title = "Synthetic website favorite verification";
const root = await mkdtemp(join(tmpdir(), "favorite-web-live-"));
const host = createFavoritesService({
  root,
  drive,
  catalog,
  namespace,
  loadDocument: async id => (id === document.id ? document : null),
  loadCustomDocument: async id => (id === custom.id ? custom : null),
});
let index: CachedCatalog | undefined;
const content = new Map<string, FavoriteSnapshot>();
const cache: FavoriteCache = {
  async catalog() {
    return index;
  },
  async saveCatalog(_a, v) {
    index = v;
  },
  async content(_a, h) {
    return content.get(h);
  },
  async saveContent(_a, h, v) {
    content.set(h, v);
  },
  async clear() {
    index = undefined;
    content.clear();
  },
};
const repo = new FavoriteReadRepository(
  account.id,
  {
    list: (_collection, kind) =>
      (kind === FAVORITE_CATALOG_KIND ? catalog : drive).list(account.id, collectionId),
    read: file => driveRead(file),
  },
  cache,
  namespace,
);
async function driveRead(file: { id: string; operationId: string; hash: string; schema: string }) {
  // Read-only HTTP transport shares the portable repository, without a Native Messaging connection.
  const response = await googleFetch(
    account!.id,
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(file.id) + "?alt=media",
  );
  return response.json();
}
const checks: string[] = [];
try {
  await host.configure({
    kind: "enable",
    accountId: account.id,
    importLocal: false,
    mutationId: randomUUID(),
  });
  await host.set({
    collection,
    documentId: document.id,
    sceneId: document.sections[0].id,
    desired: true,
    mutationId: randomUUID(),
  });
  await host.set({
    collection,
    ...customFavoriteTarget(custom.id),
    desired: true,
    mutationId: randomUUID(),
  });
  const synced = await host.sync(collection);
  assert.equal(synced.state, "synced", synced.issue);
  await repo.refresh();
  assert.equal(repo.list().length, 2);
  checks.push("Real Drive contains complete lightweight catalog for scene and custom Markdown");
  for (const item of repo.list()) {
    const snapshot = await repo.get(item.key);
    assert.equal(snapshot.snapshotVersion, item.kind === "custom" ? 2 : 1);
  }
  checks.push("Portable read-only repository downloads and validates exact snapshot payloads");
  await host.set({
    collection,
    ...customFavoriteTarget(custom.id),
    desired: false,
    mutationId: randomUUID(),
  });
  assert.equal((await host.sync(collection)).state, "synced");
  await repo.refresh();
  assert.equal(repo.list().length, 1);
  checks.push("Desktop cancellation is visible through real Drive catalog");
  await writeFile(
    ".audit/favorites-web/live-drive.json",
    JSON.stringify(
      { realDrive: true, webOAuth: false, installedHostChanged: false, checks },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ realDrive: true, webOAuth: false, checks }, null, 2));
} finally {
  const listed = await Promise.allSettled([
    drive.list(account.id, collectionId),
    catalog.list(account.id, collectionId),
  ]);
  const files = listed.flatMap(result => (result.status === "fulfilled" ? result.value : []));
  if (listed.some(result => result.status === "rejected"))
    console.error("Cleanup listing unavailable; remote cleanup could not be verified.");
  for (const file of files)
    await googleFetch(
      account.id,
      "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(file.id),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
  if (listed.every(result => result.status === "fulfilled"))
    console.log("Synthetic verification files moved to Trash.");
}
