import { z } from "zod";
import {
  FavoriteRecordHeaderSchema,
  FavoriteSummarySchema,
  favoriteText,
  reduceFavorite,
  type FavoriteRecord,
} from "./favorites";

export const FAVORITE_CATALOG_MAX_BYTES = 1024 * 1024;
export const FAVORITE_OPERATION_KIND = "favorite-operation";
export const FAVORITE_CATALOG_KIND = "favorite-catalog-operation";
const base = FavoriteRecordHeaderSchema.omit({ schemaVersion: true }).extend({
  catalogVersion: z.literal(1),
  source: z
    .object({ id: z.string().min(1).max(256), hash: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
});
export const FavoriteCatalogOperationSchema = z
  .discriminatedUnion("action", [
    base
      .extend({
        action: z.literal("add"),
        summary: FavoriteSummarySchema.omit({ pending: true }).strict(),
      })
      .strict(),
    base.extend({ action: z.literal("remove") }).strict(),
  ])
  .superRefine((record, ctx) => {
    if (!record.version[record.writerId])
      ctx.addIssue({ code: "custom", message: "Missing writer version" });
    if (
      record.action === "add" &&
      (record.key !== record.summary.key ||
        record.origin.documentId !== record.summary.documentId ||
        record.origin.sceneId !== record.summary.sceneId)
    )
      ctx.addIssue({ code: "custom", message: "Catalog summary identity mismatch" });
  });
export type FavoriteCatalogOperation = z.infer<typeof FavoriteCatalogOperationSchema>;
export type FavoriteFileReference = {
  id: string;
  operationId: string;
  hash: string;
  schema: string;
};
export function favoriteIdentityBytes(origin: { documentId: string; sceneId: string }) {
  return JSON.stringify([origin.documentId, origin.sceneId]);
}
export function favoriteCollectionBytes(accountId: string, namespace = "favorites-v1") {
  return namespace + ":" + accountId;
}
export function captureFavoriteCatalog(
  record: FavoriteRecord,
  source: { id: string; hash: string },
): FavoriteCatalogOperation {
  const { schemaVersion: _schema, ...header } = record;
  const common = {
    catalogVersion: 1,
    operationId: header.operationId,
    collectionId: header.collectionId,
    key: header.key,
    origin: header.origin,
    writerId: header.writerId,
    version: header.version,
    createdAt: header.createdAt,
    requestHash: header.requestHash,
    source: { id: source.id, hash: source.hash },
  };
  if (record.action === "remove")
    return FavoriteCatalogOperationSchema.parse({ ...common, action: "remove" });
  const text = favoriteText(record.snapshot);
  return FavoriteCatalogOperationSchema.parse({
    ...common,
    action: "add",
    summary: {
      ...record.origin,
      key: record.key,
      kind: record.snapshot.snapshotVersion === 2 ? "custom" : "scene",
      title: text.title,
      sourceTitle: record.snapshot.source.title,
      language: text.language,
      excerpt: text.excerpt,
      savedAt: record.createdAt,
    },
  });
}
export function catalogWinners(records: readonly FavoriteCatalogOperation[]) {
  return [...new Set(records.map(r => r.key))]
    .flatMap(key => {
      const winner = reduceFavorite(records.filter(r => r.key === key));
      return winner ? [winner] : [];
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key));
}
/** A catalog is a projection: never treat a partial projection as a complete collection. */
export function verifyFavoriteCatalogCoverage(
  sources: readonly FavoriteFileReference[],
  catalog: readonly FavoriteCatalogOperation[],
  collectionId: string,
) {
  const sourceIds = new Set(sources.map(s => s.operationId));
  const selected: FavoriteCatalogOperation[] = [];
  for (const source of sources) {
    if (source.schema !== "1") throw new Error("Unsupported favorite operation format");
    const matching = catalog.filter(c => c.operationId === source.operationId);
    if (!matching.length)
      throw new Error("Favorite catalog is incomplete. Sync the original desktop first.");
    const first = matching[0];
    if (matching.some(c => JSON.stringify(c) !== JSON.stringify(first)))
      throw new Error("Conflicting catalog operations");
    if (
      first.collectionId !== collectionId ||
      first.source.id !== source.id ||
      first.source.hash !== source.hash
    )
      throw new Error("Favorite catalog source mismatch");
    selected.push(first);
  }
  if (catalog.some(c => !sourceIds.has(c.operationId)))
    throw new Error("Favorite source is missing. Original data was preserved.");
  return selected;
}
