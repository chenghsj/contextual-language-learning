import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  captureFavorite,
  captureCustomFavorite,
  customFavoriteTarget,
  parseFavoriteSnapshot,
  type FavoriteRecord,
} from "@contextual/core";
import { customFavoriteFixture } from "../../../../packages/core/test/custom-favorite-fixture";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { createFavoriteDrive } from "./favorites";
import { DriveRequestError } from "./api";
import { favoriteBytes, favoriteKey } from "../favorites/service";

const collection = "c".repeat(64);
function fixture() {
  const document = pointsFixture().document;
  const writerId = randomUUID();
  const origin = { documentId: document.id, sceneId: document.sections[0].id };
  const record: FavoriteRecord = {
    schemaVersion: 1,
    operationId: randomUUID(),
    collectionId: collection,
    key: favoriteKey(origin),
    origin,
    writerId,
    version: { [writerId]: 1 },
    createdAt: new Date().toISOString(),
    requestHash: "a".repeat(64),
    action: "add",
    snapshot: captureFavorite(document, origin.sceneId, new Date().toISOString(), "b".repeat(64)),
  };
  return record;
}
function meta(record: FavoriteRecord, id = "reserved") {
  return {
    id,
    appProperties: {
      contextualKind: "favorite-operation",
      contextualFavoriteCollection: collection,
      contextualFavoriteOperation: record.operationId,
      contextualFavoriteSchema: "1",
      contextualContentHash: createHash("sha256").update(favoriteBytes(record)).digest("hex"),
    },
  };
}
test("custom snapshots upload and read back complete Markdown with verified operation bytes", async () => {
  const custom = customFavoriteFixture();
  const record = fixture();
  if (record.action !== "add") throw new Error("Expected add record");
  record.origin = customFavoriteTarget(custom.id);
  record.key = favoriteKey(record.origin);
  record.snapshot = captureCustomFavorite(custom, custom.createdAt, "fixture");
  let uploaded = false;
  const drive = createFavoriteDrive({
    folder: async () => "folder",
    fetch: async (_account, url, init) => {
      if (init?.method === "POST") {
        uploaded = true;
        assert.match(await new Response(init.body).text(), /完整的自訂教材內容/);
        return Response.json({ id: "reserved" });
      }
      return url.includes("alt=media")
        ? new Response(favoriteBytes(record))
        : Response.json(meta(record));
    },
  });
  await drive.write("account", collection, record, "reserved");
  assert.equal(uploaded, true);
  // Direct read uses the same metadata that a paginated listing supplies.
  const read = await drive.read("account", collection, {
    id: "reserved",
    operationId: record.operationId,
    hash: meta(record).appProperties.contextualContentHash,
    schema: "1",
  });
  assert.deepEqual(read, record);
  assert.equal(parseFavoriteSnapshot(record.snapshot).snapshotVersion, 2);
});
test("favorite listings fully paginate beyond 500 and discover newer versions without version filtering", async () => {
  let calls = 0;
  const record = fixture();
  const drive = createFavoriteDrive({
    folder: async () => "folder",
    fetch: async (_account, url) => {
      calls++;
      assert.ok(!new URL(url).searchParams.get("q")?.includes("contextualFavoriteSchema"));
      const page =
        calls === 1
          ? Array.from({ length: 1000 }, (_, i) => ({
              ...meta(record, String(i)),
              appProperties: {
                ...meta(record).appProperties,
                contextualFavoriteOperation: randomUUID(),
              },
            }))
          : [
              {
                ...meta(record, "future"),
                appProperties: { ...meta(record).appProperties, contextualFavoriteSchema: "2" },
              },
            ];
      return Response.json({ files: page, ...(calls === 1 ? { nextPageToken: "next" } : {}) });
    },
  });
  const files = await drive.list("account", collection);
  assert.equal(files.length, 1001);
  assert.equal(files.at(-1)?.schema, "2");
  assert.equal(calls, 2);
});
test("incomplete listings stop synchronization instead of silently returning a partial collection", async () => {
  const drive = createFavoriteDrive({
    folder: async () => "folder",
    fetch: async () => Response.json({ files: [], incompleteSearch: true }),
  });
  await assert.rejects(drive.list("account", collection), /incomplete/);
});
test("409 retries verify reserved identity and bytes, rejecting a conflicting existing file", async () => {
  const record = fixture();
  let uploads = 0,
    bad = false;
  const drive = createFavoriteDrive({
    folder: async () => "folder",
    fetch: async (_account, url, init) => {
      if (init?.method === "POST") {
        uploads++;
        throw new DriveRequestError(409, "already exists");
      }
      return url.includes("alt=media")
        ? new Response(bad ? "{}" : favoriteBytes(record))
        : Response.json(meta(record));
    },
  });
  await drive.write("account", collection, record, "reserved");
  assert.equal(uploads, 1);
  bad = true;
  await assert.rejects(drive.write("account", collection, record, "reserved"), /checksum/);
});
test("large favorite uploads use resumable transfer and verify the completed contents", async () => {
  const record = fixture();
  if (record.action !== "add") throw new Error("fixture");
  const base = record.snapshot.cues[0];
  for (let i = 0; i < 1300; i++)
    record.snapshot.cues.push({ ...base, id: "extra-" + i, originalText: "測".repeat(1500) });
  const methods: string[] = [];
  const drive = createFavoriteDrive({
    folder: async () => "folder",
    fetch: async (_account, url, init) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") {
        assert.ok(url.includes("uploadType=resumable"));
        return new Response("", {
          headers: {
            location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture",
          },
        });
      }
      if (init?.method === "PUT") {
        assert.equal(init.body, favoriteBytes(record));
        return Response.json({ id: "reserved" });
      }
      return url.includes("alt=media")
        ? new Response(favoriteBytes(record))
        : Response.json(meta(record));
    },
  });
  await drive.write("account", collection, record, "reserved");
  assert.deepEqual(methods, ["POST", "PUT", "GET", "GET"]);
});
test("favorite downloads reject oversized content before parsing", async () => {
  const record = fixture();
  const item = meta(record);
  const drive = createFavoriteDrive({
    folder: async () => "folder",
    fetch: async (_account, url) =>
      url.includes("alt=media")
        ? new Response("{}", { headers: { "content-length": String(21 * 1024 * 1024) } })
        : Response.json(item),
  });
  await assert.rejects(
    drive.read("account", collection, {
      id: item.id,
      operationId: record.operationId,
      hash: item.appProperties.contextualContentHash,
      schema: "1",
    }),
    /20 MB/,
  );
});
