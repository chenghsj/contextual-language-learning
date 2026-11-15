import { z } from "zod";
import {
  FavoriteSnapshotSchema,
  SceneFavoriteSnapshotSchema,
  CustomFavoriteSnapshotSchema,
  type FavoriteSnapshot,
  type SceneFavoriteSnapshot,
  type CustomFavoriteSnapshot,
} from "./favorites-schema-v1";
import type { CustomDocument } from "./custom";
import type { LearningDocument } from "./schema";
export {
  FavoriteSnapshotSchema,
  SceneFavoriteSnapshotSchema,
  CustomFavoriteSnapshotSchema,
  type FavoriteSnapshot,
  type SceneFavoriteSnapshot,
  type CustomFavoriteSnapshot,
} from "./favorites-schema-v1";

export const FAVORITE_MAX_BYTES = 20 * 1024 * 1024;
export const FAVORITE_MAX_VECTOR_ENTRIES = 2048;
export const FavoriteCollectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local") }).strict(),
  z.object({ kind: z.literal("account"), accountId: z.string().min(1).max(256) }).strict(),
]);
export type FavoriteCollection = z.infer<typeof FavoriteCollectionSchema>;
export const FavoriteIdentitySchema = z
  .object({ documentId: z.string().uuid(), sceneId: z.string().uuid() })
  .strict();
export type FavoriteIdentity = z.infer<typeof FavoriteIdentitySchema>;
/** A whole custom document occupies its own document-ID slot in the legacy scene-key protocol. */
export function customFavoriteTarget(documentId: string): FavoriteIdentity {
  return { documentId, sceneId: documentId };
}
export const FavoriteSetSchema = FavoriteIdentitySchema.extend({
  collection: FavoriteCollectionSchema,
  mutationId: z.string().uuid(),
  desired: z.boolean(),
});
export type FavoriteSet = z.infer<typeof FavoriteSetSchema>;
export const FavoriteConfigureSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("enable"),
      accountId: z.string().min(1).max(256),
      importLocal: z.boolean(),
      mutationId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("disable"),
      accountId: z.string().min(1).max(256),
      mutationId: z.string().uuid(),
    })
    .strict(),
]);
export type FavoriteConfigure = z.infer<typeof FavoriteConfigureSchema>;
export const FavoriteSummarySchema = FavoriteIdentitySchema.extend({
  kind: z.enum(["scene", "custom"]).optional(),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string(),
  sourceTitle: z.string(),
  language: z.string(),
  excerpt: z.string(),
  savedAt: z.string().datetime(),
  pending: z.boolean(),
});
export type FavoriteSummary = z.infer<typeof FavoriteSummarySchema>;
export const FavoritePageSchema = z.object({
  items: z.array(FavoriteSummarySchema).max(100),
  nextCursor: z.string().optional(),
  partial: z.boolean(),
});
export type FavoritePage = z.infer<typeof FavoritePageSchema>;
export const FavoriteQuerySchema = z.object({
  search: z.string().max(500).optional(),
  language: z.string().max(20).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).default(40),
});
export type FavoriteQuery = z.infer<typeof FavoriteQuerySchema>;
export const FavoriteSyncStatusSchema = z.object({
  collection: FavoriteCollectionSchema,
  enabled: z.boolean(),
  state: z.enum([
    "local",
    "disabled",
    "pending",
    "syncing",
    "synced",
    "offline",
    "auth-required",
    "partial",
    "error",
  ]),
  pending: z.number().int().nonnegative(),
  issue: z.string().max(1200).optional(),
});
export type FavoriteSyncStatus = z.infer<typeof FavoriteSyncStatusSchema>;
export interface FavoritesService {
  states(
    collection: FavoriteCollection,
    documentId: string,
    sceneIds: string[],
  ): Promise<Record<string, boolean>>;
  set(request: FavoriteSet): Promise<FavoriteSummary | null>;
  list(collection: FavoriteCollection, query: FavoriteQuery): Promise<FavoritePage>;
  get(collection: FavoriteCollection, key: string): Promise<FavoriteSnapshot>;
  configure(change: FavoriteConfigure): Promise<FavoriteSyncStatus>;
  status(collection: FavoriteCollection): Promise<FavoriteSyncStatus>;
  sync(collection: FavoriteCollection): Promise<FavoriteSyncStatus>;
}
export const FavoriteRecordHeaderSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: z.string().uuid(),
  collectionId: z.string().regex(/^(local|[a-f0-9]{64})$/),
  key: z.string().regex(/^[a-f0-9]{64}$/),
  origin: FavoriteIdentitySchema,
  writerId: z.string().uuid(),
  version: z
    .record(z.string().uuid(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
    .refine(
      v => Object.keys(v).length <= FAVORITE_MAX_VECTOR_ENTRIES,
      "Favorite causal capacity exceeded",
    ),
  createdAt: z.string().datetime(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const FavoriteRecordSchema = z
  .discriminatedUnion("action", [
    FavoriteRecordHeaderSchema.extend({
      action: z.literal("add"),
      snapshot: FavoriteSnapshotSchema,
    }).strict(),
    FavoriteRecordHeaderSchema.extend({ action: z.literal("remove") }).strict(),
  ])
  .superRefine((record, ctx) => {
    if (!record.version[record.writerId])
      ctx.addIssue({ code: "custom", message: "Missing writer version" });
    if (
      record.action === "add" &&
      (record.origin.documentId !== record.snapshot.origin.documentId ||
        record.origin.sceneId !== record.snapshot.origin.sceneId)
    )
      ctx.addIssue({ code: "custom", message: "Snapshot origin mismatch" });
  });
export type FavoriteRecord = z.infer<typeof FavoriteRecordSchema>;

export function dominates(a: FavoriteRecord["version"], b: FavoriteRecord["version"]): boolean {
  return (
    Object.keys(b).every(k => (a[k] ?? 0) >= b[k]) && Object.keys(a).some(k => a[k] > (b[k] ?? 0))
  );
}
export type FavoriteCausalOperation = Pick<FavoriteRecord, "action" | "operationId" | "version">;
export function favoriteFrontier<T extends FavoriteCausalOperation>(records: readonly T[]): T[] {
  return records.filter(record => !records.some(other => dominates(other.version, record.version)));
}
export function reduceFavorite<T extends FavoriteCausalOperation>(
  records: readonly T[],
): Extract<T, { action: "add" }> | null {
  const frontier = favoriteFrontier(records);
  if (frontier.some(r => r.action === "remove")) return null;
  return (
    frontier
      .filter((r): r is Extract<T, { action: "add" }> => r.action === "add")
      .sort((a, b) => a.operationId.localeCompare(b.operationId))[0] ?? null
  );
}
export function nextFavoriteVersion(
  records: readonly Pick<FavoriteRecord, "version">[],
  writerId: string,
): FavoriteRecord["version"] {
  const version: FavoriteRecord["version"] = {};
  for (const record of records)
    for (const [writer, count] of Object.entries(record.version))
      version[writer] = Math.max(version[writer] ?? 0, count);
  version[writerId] = (version[writerId] ?? 0) + 1;
  if (
    Object.keys(version).length > FAVORITE_MAX_VECTOR_ENTRIES ||
    !Number.isSafeInteger(version[writerId])
  )
    throw new Error("Favorite causal capacity exceeded");
  return version;
}
export function validateFavoriteSnapshot(snapshot: FavoriteSnapshot): FavoriteSnapshot {
  if (snapshot.snapshotVersion === 2) {
    if (
      snapshot.document.id !== snapshot.origin.documentId ||
      snapshot.origin.sceneId !== snapshot.origin.documentId
    )
      throw new Error("Favorite identity mismatch");
    return snapshot;
  }
  const cues = new Map(snapshot.cues.map(c => [c.id, c]));
  const utterances = [...snapshot.scene.utterances, ...snapshot.supportingUtterances];
  const points = new Map(snapshot.points.map(p => [p.id, p]));
  const checkCues = (ids: string[]) => {
    if (ids.some(id => !cues.has(id))) throw new Error("Favorite cue reference missing");
  };
  const checkSpans = (spans: { cueId: string; start: number; end: number }[]) => {
    for (const span of spans) {
      const cue = cues.get(span.cueId);
      if (!cue || span.start >= span.end || span.end > cue.originalText.length)
        throw new Error("Favorite source span invalid");
    }
  };
  if (
    snapshot.scene.id !== snapshot.origin.sceneId ||
    cues.size !== snapshot.cues.length ||
    points.size !== snapshot.points.length ||
    new Set(utterances.map(u => u.id)).size !== utterances.length
  )
    throw new Error("Favorite identity mismatch");
  checkCues([
    ...snapshot.scene.cueIds,
    ...snapshot.scene.contextCueIds,
    ...snapshot.scene.context.evidenceCueIds,
    ...snapshot.scene.translations.map(t => t.cueId),
    ...(snapshot.scene.pronunciations ?? []).map(p => p.cueId),
  ]);
  for (const u of utterances) {
    checkCues([...u.cueIds, ...u.contextCueIds]);
    checkSpans(u.sourceSpans);
    for (const c of u.chunks ?? []) checkSpans(c.spans);
    if (u.pointIds.some(id => !points.has(id))) throw new Error("Favorite point reference missing");
  }
  for (const p of snapshot.points) {
    checkCues([...p.sourceCueIds, ...p.contextCueIds]);
    checkSpans(p.sourceSpans);
    if (p.utteranceIds.some(id => !utterances.some(u => u.id === id)))
      throw new Error("Favorite utterance reference missing");
  }
  for (const item of snapshot.reusableItems) {
    if (item.pointIds.some(id => !points.has(id))) throw new Error("Favorite item point missing");
    for (const form of item.sourceForms) {
      checkCues(form.cueIds);
      checkSpans(form.sourceSpans);
    }
  }
  const timingTargets = new Set([...cues.keys(), ...utterances.map(u => u.id)]);
  if (
    Object.keys(snapshot.playbackOverrides).some(id => !timingTargets.has(id)) ||
    Object.keys(snapshot.scenePlaybackOverrides).some(id => id !== snapshot.scene.id)
  )
    throw new Error("Favorite timing target missing");
  for (const d of snapshot.pronunciationDiagnostics) {
    if (
      (d.cueId && !cues.has(d.cueId)) ||
      (d.itemId && !snapshot.reusableItems.some(i => i.id === d.itemId))
    )
      throw new Error("Favorite diagnostic target missing");
  }
  return snapshot;
}
export function parseFavoriteSnapshot(input: unknown): FavoriteSnapshot {
  return validateFavoriteSnapshot(FavoriteSnapshotSchema.parse(input));
}
export function captureFavorite(
  document: LearningDocument,
  sceneId: string,
  capturedAt: string,
  documentRevision: string,
): SceneFavoriteSnapshot {
  const scene = document.sections.find(s => s.id === sceneId);
  if (!scene) throw new Error("Scene not found");
  const allUtterances = document.sections.flatMap(s => s.utterances);
  const utteranceIds = new Set(scene.utterances.map(u => u.id));
  const pointIds = new Set<string>();
  const itemIds = new Set<string>();
  let count = -1;
  while (count !== utteranceIds.size + pointIds.size + itemIds.size) {
    count = utteranceIds.size + pointIds.size + itemIds.size;
    for (const u of allUtterances)
      if (utteranceIds.has(u.id)) for (const id of u.pointIds) pointIds.add(id);
    for (const p of document.points)
      if (pointIds.has(p.id)) for (const id of p.utteranceIds) utteranceIds.add(id);
    for (const item of document.reusableItems)
      if (item.pointIds.some(id => pointIds.has(id))) {
        itemIds.add(item.id);
        for (const id of item.pointIds) pointIds.add(id);
      }
  }
  const points = document.points.filter(p => pointIds.has(p.id));
  const reusableItems = document.reusableItems.filter(i => itemIds.has(i.id));
  const supportingUtterances = allUtterances.filter(
    u => utteranceIds.has(u.id) && !scene.utterances.some(s => s.id === u.id),
  );
  const utterances = [...scene.utterances, ...supportingUtterances];
  const cueIds = new Set([
    ...scene.cueIds,
    ...scene.contextCueIds,
    ...scene.context.evidenceCueIds,
    ...scene.translations.map(t => t.cueId),
    ...(scene.pronunciations ?? []).map(p => p.cueId),
    ...utterances.flatMap(u => [
      ...u.cueIds,
      ...u.contextCueIds,
      ...u.sourceSpans.map(s => s.cueId),
      ...(u.chunks ?? []).flatMap(c => c.spans.map(s => s.cueId)),
    ]),
    ...points.flatMap(p => [
      ...p.sourceCueIds,
      ...p.contextCueIds,
      ...p.sourceSpans.map(s => s.cueId),
    ]),
    ...reusableItems.flatMap(i =>
      i.sourceForms.flatMap(f => [...f.cueIds, ...f.sourceSpans.map(s => s.cueId)]),
    ),
  ]);
  const snapshot = SceneFavoriteSnapshotSchema.parse({
    snapshotVersion: 1,
    origin: { documentId: document.id, sceneId, documentRevision, capturedAt },
    source: document.source,
    profile: document.profile,
    scene,
    cues: document.cues.filter(c => cueIds.has(c.id)),
    points,
    reusableItems,
    supportingUtterances,
    pronunciationDiagnostics: (document.execution?.pronunciationDiagnostics ?? []).filter(
      d =>
        d.sceneId === sceneId ||
        (d.cueId && cueIds.has(d.cueId)) ||
        (d.itemId && itemIds.has(d.itemId)),
    ),
    playbackOverrides: Object.fromEntries(
      Object.entries(document.playbackOverrides ?? {}).filter(
        ([id]) => cueIds.has(id) || utteranceIds.has(id),
      ),
    ),
    scenePlaybackOverrides: Object.fromEntries(
      Object.entries(document.scenePlaybackOverrides ?? {}).filter(([id]) => id === sceneId),
    ),
  });
  validateFavoriteSnapshot(snapshot);
  return snapshot;
}

export function captureCustomFavorite(
  document: CustomDocument,
  capturedAt: string,
  documentRevision: string,
): CustomFavoriteSnapshot {
  return CustomFavoriteSnapshotSchema.parse({
    snapshotVersion: 2,
    kind: "custom",
    origin: { ...customFavoriteTarget(document.id), capturedAt, documentRevision },
    source: document.request.source,
    document: {
      id: document.id,
      title: document.title,
      createdAt: document.createdAt,
      markdown: document.markdown,
    },
    cues: document.request.cues,
  });
}

export type CustomFavoriteReaderDocument = CustomFavoriteSnapshot["document"] & {
  request: Pick<CustomDocument["request"], "source" | "cues">;
};
export function customFavoriteReaderDocument(
  snapshot: CustomFavoriteSnapshot,
): CustomFavoriteReaderDocument {
  return { ...snapshot.document, request: { source: snapshot.source, cues: snapshot.cues } };
}

export function favoriteText(snapshot: FavoriteSnapshot): {
  title: string;
  language: string;
  excerpt: string;
  search: string;
} {
  if (snapshot.snapshotVersion === 2) {
    // Custom generation does not declare a target language; do not infer one from mixed Markdown.
    return {
      title: snapshot.document.title,
      language: "unspecified",
      excerpt: snapshot.document.markdown.slice(0, 500),
      search: [snapshot.document.title, snapshot.source.title, snapshot.document.markdown].join(
        " ",
      ),
    };
  }
  const excerpt = snapshot.scene.cueIds
    .map(id => snapshot.cues.find(c => c.id === id)?.originalText ?? "")
    .join(" ");
  return {
    title: snapshot.scene.title,
    language: snapshot.profile.targetLanguage,
    excerpt: excerpt.slice(0, 500),
    search: [
      snapshot.scene.title,
      snapshot.source.title,
      ...snapshot.cues.map(c => c.originalText),
      ...snapshot.scene.translations.map(t => t.text),
    ].join(" "),
  };
}
export type FavoriteReaderDocument = Omit<LearningDocument, "generation" | "execution"> & {
  execution: { pronunciationDiagnostics: SceneFavoriteSnapshot["pronunciationDiagnostics"] };
};
export function favoriteReaderDocument(
  snapshot: SceneFavoriteSnapshot,
  progressId: string,
): FavoriteReaderDocument {
  return {
    id: progressId,
    schemaVersion: 7,
    createdAt: snapshot.origin.capturedAt,
    source: snapshot.source,
    profile: snapshot.profile,
    cues: snapshot.cues,
    sections: [snapshot.scene],
    points: snapshot.points,
    reusableItems: snapshot.reusableItems,
    playbackOverrides: snapshot.playbackOverrides,
    scenePlaybackOverrides: snapshot.scenePlaybackOverrides,
    execution: { pronunciationDiagnostics: snapshot.pronunciationDiagnostics },
  };
}
