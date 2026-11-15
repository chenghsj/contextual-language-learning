import assert from "node:assert/strict";
import test from "node:test";
import { captureFavorite, captureCustomFavorite } from "@contextual/core";
import { customFavoriteFixture } from "../../../../packages/core/test/custom-favorite-fixture";
import { document } from "../../dev/reader-fixture";
import { getFavorite, request } from "./host-client";
import { FavoriteChunkAssembler } from "./favorite-chunks";
import { testRuntime } from "./test-runtime";

const collection = { kind: "local" } as const;
const key = "1".repeat(64);
const snapshot = captureFavorite(document, document.sections[0].id, document.createdAt, "fixture");
const chunk = (index: number, total: number, data: Uint8Array) => ({
  type: "favoriteChunk" as const,
  id: crypto.randomUUID(),
  collection,
  key,
  index,
  total,
  dataBase64: Buffer.from(data).toString("base64"),
});

test("favorite client assembles UTF-8 chunks and validates the frozen snapshot", async () => {
  const app = testRuntime();
  const result = getFavorite(collection, key, app.runtime);
  const port = app.ports[0];
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const middle = Math.floor(bytes.length / 2);
  port.receive({ ...chunk(0, 2, bytes.subarray(0, middle)), id: port.sent[0].id });
  assert.equal(port.closed, false);
  port.receive({ ...chunk(1, 2, bytes.subarray(middle)), id: port.sent[0].id });
  assert.deepEqual(await result, snapshot);
  assert.equal(port.closed, true);
});

test("custom favorite client assembles large multi-byte Markdown with no original document request", async () => {
  const custom = customFavoriteFixture();
  custom.markdown = "日本語".repeat(65000);
  const saved = captureCustomFavorite(custom, custom.createdAt, "fixture");
  const app = testRuntime();
  const result = getFavorite(collection, key, app.runtime);
  const port = app.ports[0];
  const bytes = Buffer.from(JSON.stringify(saved));
  const size = 256 * 1024,
    total = Math.ceil(bytes.length / size);
  assert.ok(total > 1);
  for (let i = 0; i < total; i++)
    port.receive({
      ...chunk(i, total, bytes.subarray(i * size, (i + 1) * size)),
      id: port.sent[0].id,
    });
  assert.deepEqual(await result, saved);
  assert.equal(port.sent.length, 1);
  assert.equal(port.sent[0].type, "getFavorite");
  assert.equal(port.closed, true);
});

test("favorite client rejects missing chunks, wrong collections and relational corruption", async () => {
  const app = testRuntime();
  const missing = getFavorite(collection, key, app.runtime);
  const first = app.ports[0];
  first.receive({ ...chunk(1, 2, Buffer.from("{}")), id: first.sent[0].id });
  await assert.rejects(missing, /Missing favorite chunks/);
  const wrong = getFavorite(collection, key, app.runtime);
  const second = app.ports[1];
  second.receive({
    id: second.sent[0].id,
    type: "favorite",
    collection: { kind: "account", accountId: "other" },
    key,
    snapshot,
  });
  await assert.rejects(wrong, /identity mismatch/);
  const corrupt = getFavorite(collection, key, app.runtime);
  const third = app.ports[2];
  third.receive({
    id: third.sent[0].id,
    type: "favorite",
    collection,
    key,
    snapshot: { ...snapshot, cues: [] },
  });
  await assert.rejects(corrupt, /cue reference missing/);
  assert.ok(app.ports.every(port => port.closed));
});

test("favorite assembly rejects duplicate parts, resource changes and oversized counts", () => {
  const assembler = new FavoriteChunkAssembler(collection, key);
  assembler.push(chunk(0, 2, Buffer.from("{")));
  assert.throws(() => assembler.push(chunk(0, 2, Buffer.from("{"))), /duplicate/);
  assert.throws(
    () => assembler.push({ ...chunk(1, 2, Buffer.from("}")), key: "2".repeat(64) }),
    /identity/,
  );
  assert.throws(
    () => new FavoriteChunkAssembler(collection, key).push(chunk(0, 81, Buffer.from("{}"))),
    /index/,
  );
});

test("favorite typed mutations wait for Host confirmation and reject domain errors", async () => {
  const app = testRuntime();
  const result = request(
    {
      type: "setFavorite",
      input: {
        collection,
        documentId: document.id,
        sceneId: snapshot.scene.id,
        desired: true,
        mutationId: crypto.randomUUID(),
      },
    },
    app.runtime,
  );
  const port = app.ports[0];
  port.receive({ id: port.sent[0].id, type: "error", message: "Disk full" });
  await assert.rejects(result, /Disk full/);
});
