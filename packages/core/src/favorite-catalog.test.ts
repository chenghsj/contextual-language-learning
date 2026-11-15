import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { pointsFixture } from "../test/learning-points-fixture";
import { captureFavorite, FavoriteRecordSchema, nextFavoriteVersion } from "./favorites";
import {
  captureFavoriteCatalog,
  catalogWinners,
  FavoriteCatalogOperationSchema,
  verifyFavoriteCatalogCoverage,
  favoriteIdentityBytes,
} from "./favorite-catalog";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const document = pointsFixture().document,
    writerId = randomUUID();
  const origin = { documentId: document.id, sceneId: document.sections[0].id };
  const record = FavoriteRecordSchema.parse({
    schemaVersion: 1,
    operationId: randomUUID(),
    collectionId: "c".repeat(64),
    key: hash(favoriteIdentityBytes(origin)),
    origin,
    writerId,
    version: { [writerId]: 1 },
    createdAt: document.createdAt,
    requestHash: "d".repeat(64),
    action: "add",
    snapshot: captureFavorite(document, origin.sceneId, document.createdAt, "fixture"),
  });
  const source = {
    id: "source-file",
    operationId: record.operationId,
    hash: hash(JSON.stringify(record)),
    schema: "1",
  };
  return { record, source, catalog: captureFavoriteCatalog(record, source) };
}
test("catalog is lightweight, source-linked and retains exact causal cancellation semantics", () => {
  const { record, source, catalog } = fixture();
  assert.equal("snapshot" in catalog, false);
  assert.ok(JSON.stringify(catalog).length < JSON.stringify(record).length);
  assert.equal(
    verifyFavoriteCatalogCoverage([source], [catalog], record.collectionId)[0].operationId,
    record.operationId,
  );
  if (record.action !== "add") throw new Error("fixture");
  const { snapshot: _snapshot, ...header } = record;
  const remove = captureFavoriteCatalog(
    FavoriteRecordSchema.parse({
      ...header,
      action: "remove",
      operationId: randomUUID(),
      version: nextFavoriteVersion([record], record.writerId),
    }),
    { id: "remove-file", hash: "e".repeat(64) },
  );
  assert.deepEqual(catalogWinners([catalog, remove]), []);
  assert.deepEqual(catalogWinners([remove, catalog]), []);
});
test("catalog rejects missing projections, deleted sources, conflicting duplicates and wrong ownership", () => {
  const { record, source, catalog } = fixture();
  assert.throws(
    () => verifyFavoriteCatalogCoverage([source], [], record.collectionId),
    /incomplete/,
  );
  assert.throws(() => verifyFavoriteCatalogCoverage([], [catalog], record.collectionId), /missing/);
  assert.throws(
    () =>
      verifyFavoriteCatalogCoverage(
        [source],
        [{ ...catalog, source: { ...catalog.source, hash: "0".repeat(64) } }],
        record.collectionId,
      ),
    /mismatch/,
  );
  assert.throws(
    () => verifyFavoriteCatalogCoverage([source], [catalog], "0".repeat(64)),
    /mismatch/,
  );
  assert.throws(
    () =>
      verifyFavoriteCatalogCoverage(
        [source],
        [catalog, { ...catalog, requestHash: "0".repeat(64) }],
        record.collectionId,
      ),
    /Conflicting/,
  );
  if (catalog.action !== "add") throw new Error("fixture");
  assert.equal(
    FavoriteCatalogOperationSchema.safeParse({
      ...catalog,
      summary: { ...catalog.summary, documentId: randomUUID() },
    }).success,
    false,
  );
});
