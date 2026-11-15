import test from "node:test";
import assert from "node:assert/strict";
import { FAVORITE_CATALOG_KIND } from "@contextual/core";
import { createBrowserDrive, DriveAccessError, sha256 } from "./drive";

const collection = "a".repeat(64);
const operationId = "00000000-0000-4000-8000-000000000001";
const metadata = (id: string) => ({
  id,
  appProperties: {
    contextualKind: FAVORITE_CATALOG_KIND,
    contextualFavoriteCollection: collection,
    contextualContentHash: "b".repeat(64),
    contextualFavoriteOperation: operationId,
    contextualFavoriteSchema: "1",
  },
});
test("browser Drive follows pagination using only authenticated GETs", async t => {
  const requests: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.ok(!init.method || init.method === "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic");
    const url = new URL(input);
    requests.push(url);
    return Response.json(
      url.searchParams.has("pageToken")
        ? { files: [metadata("second")] }
        : { files: [metadata("first")], nextPageToken: "next" },
    );
  });
  const drive = createBrowserDrive("synthetic", new AbortController().signal);
  assert.deepEqual(
    (await drive.list(collection, FAVORITE_CATALOG_KIND)).map(f => f.id),
    ["first", "second"],
  );
  assert.equal(requests[1].searchParams.get("pageToken"), "next");
});
test("browser Drive rejects incomplete, looping and foreign inventories", async t => {
  let page: object = { files: [], incompleteSearch: true };
  t.mock.method(globalThis, "fetch", async () => Response.json(page));
  const drive = createBrowserDrive("synthetic", new AbortController().signal);
  await assert.rejects(drive.list(collection, FAVORITE_CATALOG_KIND), /不完整/);
  page = { files: [], nextPageToken: "repeated" };
  await assert.rejects(drive.list(collection, FAVORITE_CATALOG_KIND), /分頁/);
  const foreign = metadata("foreign");
  foreign.appProperties.contextualFavoriteCollection = "c".repeat(64);
  page = { files: [foreign] };
  await assert.rejects(drive.list(collection, FAVORITE_CATALOG_KIND), /識別/);
});
test("browser Drive enforces streamed size and checksum before parsing content", async t => {
  const body = JSON.stringify({ catalogVersion: 1, title: "合成資料" });
  const hash = await sha256(body);
  t.mock.method(globalThis, "fetch", async () => new Response(body));
  const drive = createBrowserDrive("synthetic", new AbortController().signal);
  const file = { id: "file", operationId, schema: "1", hash };
  assert.deepEqual(await drive.read(file, 1024), JSON.parse(body));
  await assert.rejects(drive.read(file, 8), /上限/);
  await assert.rejects(drive.read({ ...file, hash: "0".repeat(64) }, 1024), /校驗/);
});
test("browser Drive reports expired authorization without retrying", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, { status: 401 });
  });
  const drive = createBrowserDrive("synthetic", new AbortController().signal);
  await assert.rejects(
    drive.list(collection, FAVORITE_CATALOG_KIND),
    (error: unknown) => error instanceof DriveAccessError && error.status === 401,
  );
  assert.equal(calls, 1);
});

async function writeFixture() {
  const { captureFavorite, FavoriteRecordSchema, favoriteIdentityBytes } =
    await import("@contextual/core");
  const { libraryFixture } = await import("./library-fixture");
  const { document } = await libraryFixture();
  const origin = { documentId: document.id, sceneId: document.sections[0].id };
  return FavoriteRecordSchema.parse({
    schemaVersion: 1,
    collectionId: collection,
    operationId,
    origin,
    key: await sha256(favoriteIdentityBytes(origin)),
    writerId: operationId,
    version: { [operationId]: 1 },
    createdAt: document.createdAt,
    requestHash: "a".repeat(64),
    action: "add",
    snapshot: captureFavorite(document, origin.sceneId, document.createdAt, "transport-test"),
  });
}
function folders(input: string) {
  const url = new URL(input);
  if (!url.searchParams.has("q")) return undefined;
  const q = url.searchParams.get("q")!;
  if (q.includes("name='AI-powered")) return "root";
  if (q.includes("name='Favorites'")) {
    assert.ok(q.includes("'root' in parents"));
    return "favorites";
  }
  assert.ok(
    q.includes("'favorites' in parents"),
    "operations/catalog are siblings inside Favorites",
  );
  return q.includes("name='operations'") ? "operations" : "catalog";
}
test("favorite upload uses reserved IDs, exact metadata, and verifies immutable duplicates", async t => {
  const record = await writeFixture(),
    text = JSON.stringify(record),
    hash = await sha256(text);
  let uploads = 0,
    mismatch = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic");
    const folder = folders(input);
    if (folder) return Response.json({ files: [{ id: folder }] });
    if (input.includes("uploadType=multipart")) {
      uploads++;
      assert.equal(init.method, "POST");
      const body = String(init.body);
      assert.ok(body.includes('"id":"reserved-operation"'));
      assert.ok(body.includes('"parents":["operations"]'));
      assert.ok(body.includes('"contextualContentHash":"' + hash + '"'));
      assert.ok(body.includes(text));
      return new Response(null, { status: 409 });
    }
    if (input.includes("alt=media"))
      return new Response(mismatch ? text.replace("transport-test", "transport-fail") : text);
    return Response.json({
      id: "reserved-operation",
      trashed: false,
      appProperties: {
        contextualKind: "favorite-operation",
        contextualFavoriteCollection: collection,
        contextualFavoriteOperation: operationId,
        contextualContentHash: hash,
      },
    });
  });
  const drive = createBrowserDrive("synthetic", new AbortController().signal);
  await drive.writeFavorite(collection, record, "reserved-operation", "favorite-operation");
  mismatch = true;
  await assert.rejects(
    drive.writeFavorite(collection, record, "reserved-operation", "favorite-operation"),
    /不一致/,
  );
  assert.equal(uploads, 2);
});
test("large favorites resume from acknowledged byte range after an interrupted PUT", async t => {
  const record = await writeFixture();
  assert.equal(record.action, "add");
  if (record.action !== "add") throw new Error("fixture");
  record.snapshot.source.title = "x".repeat(6 * 1024 * 1024);
  const total = new TextEncoder().encode(JSON.stringify(record)).length;
  let puts = 0,
    multipart = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const folder = folders(input);
    if (folder) return Response.json({ files: [{ id: folder }] });
    if (input.includes("uploadType=multipart")) multipart = true;
    if (input.includes("uploadType=resumable")) {
      assert.equal(new Headers(init.headers).get("X-Upload-Content-Length"), String(total));
      return new Response(null, {
        status: 200,
        headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" },
      });
    }
    const range = new Headers(init.headers).get("Content-Range");
    puts++;
    if (puts === 1) {
      assert.equal(range, `bytes 0-${total - 1}/${total}`);
      throw new TypeError("synthetic disconnect");
    }
    if (puts === 2) {
      assert.equal(range, `bytes */${total}`);
      return new Response(null, { status: 308, headers: { Range: "bytes=0-262143" } });
    }
    assert.equal(range, `bytes 262144-${total - 1}/${total}`);
    assert.equal((init.body as Uint8Array).byteLength, total - 262144);
    return Response.json({ id: "reserved-large" });
  });
  const drive = createBrowserDrive("synthetic", new AbortController().signal);
  await drive.writeFavorite(collection, record, "reserved-large", "favorite-operation");
  assert.equal(multipart, false);
  assert.equal(puts, 3);
});
