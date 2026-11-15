// Development-only synthetic Drive. Vite removes this entry from production builds.
import {
  captureFavorite,
  parseFavoriteSnapshot,
  FavoriteRecordSchema,
  captureFavoriteCatalog,
  favoriteCollectionBytes,
  favoriteIdentityBytes,
  FAVORITE_CATALOG_KIND,
  nextFavoriteVersion,
  type FavoriteRecord,
} from "@contextual/core";
import { document } from "../../extension/dev/reader-fixture";
import { sha256 } from "./drive";
import type { DemoSession } from "./main";
import { libraryFixture } from "./library-fixture";
export async function createDemo(): Promise<DemoSession> {
  const library = await libraryFixture();
  const account = { id: "synthetic-web-account", email: "reader@example.test" };
  const collectionId = await sha256(favoriteCollectionBytes(account.id));
  const writerId = "00000000-0000-4000-8000-0000000000aa",
    customId = "00000000-0000-4000-8000-0000000000cc";
  const snapshots = [
    captureFavorite(document, document.sections[0].id, "2026-10-23T00:00:00.000Z", "fixture"),
    parseFavoriteSnapshot({
      snapshotVersion: 2,
      kind: "custom",
      origin: {
        documentId: customId,
        sceneId: customId,
        documentRevision: "custom-fixture",
        capturedAt: "2026-10-23T00:00:00.000Z",
      },
      source: { platform: "import", title: "自訂學習筆記" },
      document: {
        id: customId,
        title: "日常會話的留白",
        createdAt: "2026-10-23T00:00:00.000Z",
        markdown:
          "# 日常會話的留白\n\n**まだ決めていない。**\n\n還沒有決定，也可以是對話的開始。\n\n## 換一種說法\n\n- 考え中です。正在考慮中。\n- あとで決めよう。晚點再決定吧。\n\n![remote](https://remote.invalid/image.png)\n<script>alert(1)</script>",
      },
      cues: document.cues,
    }),
  ];
  const receipts = new Map<string, { source?: string; catalog?: string }>();
  const records: FavoriteRecord[] = [];
  for (const [i, snapshot] of snapshots.entries())
    records.push(
      FavoriteRecordSchema.parse({
        schemaVersion: 1,
        operationId: "00000000-0000-4000-8000-0000000000b" + i,
        collectionId,
        key: await sha256(favoriteIdentityBytes(snapshot.origin)),
        origin: { documentId: snapshot.origin.documentId, sceneId: snapshot.origin.sceneId },
        writerId,
        version: { [writerId]: 1 },
        createdAt: "2026-10-23T00:00:00.000Z",
        requestHash: "a".repeat(64),
        action: "add",
        snapshot,
      }),
    );
  let missing = false,
    fail = false;
  const sourceFiles = async () =>
    Promise.all(
      records.map(async r => ({
        id: receipts.get(r.operationId)?.source ?? "source-" + r.operationId,
        operationId: r.operationId,
        hash: await sha256(JSON.stringify(r)),
        schema: "1",
      })),
    );
  const catalogs = async () =>
    Promise.all(
      (await sourceFiles()).map((source, i) =>
        captureFavoriteCatalog(records[i], { id: source.id, hash: source.hash }),
      ),
    );
  const reads: string[] = [];
  Object.assign(window, {
    webAcceptance: {
      reads,
      setMissing: (value: boolean) => (missing = value),
      setFailure: (value: boolean) => (fail = value),
      removeCustom: () => {
        if (records[1].action !== "add") throw new Error("fixture");
        const { snapshot: _snapshot, ...header } = records[1];
        records.push(
          FavoriteRecordSchema.parse({
            ...header,
            action: "remove",
            operationId: "00000000-0000-4000-8000-0000000000ff",
            version: nextFavoriteVersion(
              records.filter(r => r.key === records[1].key),
              writerId,
            ),
          }),
        );
      },
    },
  });
  return {
    account,
    drive: {
      ...library.drive,
      async reserve() {
        return "demo-" + crypto.randomUUID();
      },
      async writeFavorite(_collection, record, id, kind) {
        const receipt = receipts.get(record.operationId) ?? {};
        if (kind === "favorite-operation") {
          const parsed = FavoriteRecordSchema.parse(record);
          const previous = records.find(item => item.operationId === record.operationId);
          if (previous && JSON.stringify(previous) !== JSON.stringify(parsed))
            throw new Error("Synthetic immutable conflict");
          if (!previous) records.push(parsed);
          receipt.source = id;
        } else receipt.catalog = id;
        receipts.set(record.operationId, receipt);
      },
      async list(_collection, kind) {
        if (fail) throw new Error("Synthetic connection failure");
        if (kind !== FAVORITE_CATALOG_KIND) return sourceFiles();
        const values = await catalogs();
        return Promise.all(
          (missing ? values.slice(1) : values).map(async r => ({
            id: receipts.get(r.operationId)?.catalog ?? "catalog-" + r.operationId,
            operationId: r.operationId,
            hash: await sha256(JSON.stringify(r)),
            schema: "1",
          })),
        );
      },
      async read(file) {
        reads.push(file.id);
        if (fail) throw new Error("Synthetic connection failure");
        const values =
          file.id.startsWith("catalog-") ||
          [...receipts.values()].some(receipt => receipt.catalog === file.id)
            ? await catalogs()
            : records;
        return values.find(r => r.operationId === file.operationId);
      },
    },
  };
}
