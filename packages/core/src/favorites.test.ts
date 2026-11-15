import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pointsFixture } from "../test/learning-points-fixture";
import { customFavoriteFixture } from "../test/custom-favorite-fixture";
import {
  captureFavorite,
  captureCustomFavorite,
  customFavoriteReaderDocument,
  parseFavoriteSnapshot,
  favoriteReaderDocument,
  reduceFavorite,
  nextFavoriteVersion,
  type FavoriteRecord,
} from "./favorites";
import { readerPresentation } from "./reader-model";
const now = "2026-10-20T00:00:00.000Z";
test("custom favorites freeze complete Markdown independently of source and generation versions", () => {
  const document = customFavoriteFixture();
  const saved = captureCustomFavorite(document, now, "revision");
  document.markdown = "Changed source";
  document.title = "Renamed";
  document.request.cues[0].originalText = "Changed subtitle";
  document.execution.promptVersion = "retired";
  const reopened = parseFavoriteSnapshot(JSON.parse(JSON.stringify(saved)) as unknown);
  assert.equal(reopened.snapshotVersion, 2);
  if (reopened.snapshotVersion !== 2) throw new Error("Expected a custom snapshot");
  const reader = customFavoriteReaderDocument(reopened);
  assert.match(reader.markdown, /完整的自訂教材內容/);
  assert.notEqual(reader.title, document.title);
  assert.notEqual(reader.request.cues[0].originalText, document.request.cues[0].originalText);
  assert.equal("execution" in reader, false);
  assert.equal("prompt" in reader.request, false);
  assert.equal("scene" in reopened, false);
  assert.throws(
    () => parseFavoriteSnapshot({ ...saved, origin: { ...saved.origin, sceneId: randomUUID() } }),
    /identity/,
  );
  assert.throws(() => parseFavoriteSnapshot({ ...saved, snapshotVersion: 3 }));
});
test("frozen capture retains reference closure and remains readable after source execution retirement", () => {
  const { document } = pointsFixture();
  const scene = document.sections[0];
  const snapshot = captureFavorite(document, scene.id, now, "c".repeat(64));
  document.execution!.promptVersion = "retired-forever";
  document.sections[0].title = "Changed";
  const parsed = parseFavoriteSnapshot(JSON.parse(JSON.stringify(snapshot)));
  if (parsed.snapshotVersion !== 1) throw new Error("Expected scene snapshot");
  const reopened = favoriteReaderDocument(parsed, "favorite:local:key");
  assert.notEqual(reopened.sections[0].title, "Changed");
  assert.equal(reopened.id, "favorite:local:key");
  assert.deepEqual(
    readerPresentation(reopened, reopened.sections[0]).focusItems[0].examples,
    snapshot.reusableItems[0].examples,
  );
  assert.throws(() => parseFavoriteSnapshot({ ...snapshot, cues: [] }), /reference|span/);
});
test("cross-scene points bring supporting utterances, item points, context and evidence cues", () => {
  const { document } = pointsFixture();
  const scene = document.sections[0];
  const other = structuredClone(scene);
  other.id = randomUUID();
  other.utterances[0].id = "support-u";
  other.utterances[0].pointIds = ["support-p"];
  const point = structuredClone(document.points[0]);
  point.id = "support-p";
  point.utteranceIds = ["support-u"];
  document.sections.push(other);
  document.points.push(point);
  document.reusableItems[0].pointIds.push(point.id);
  const snapshot = captureFavorite(document, scene.id, now, "c".repeat(64));
  assert.equal(snapshot.supportingUtterances[0].id, "support-u");
  assert.ok(snapshot.points.some(p => p.id === point.id));
  assert.equal(favoriteReaderDocument(snapshot, "independent").sections.length, 1);
});
test("causal remove wins across permutations and a later observed add restores independently of clock", () => {
  const { document } = pointsFixture();
  const snapshot = captureFavorite(document, document.sections[0].id, now, "c".repeat(64));
  const a = randomUUID(),
    b = randomUUID();
  const base = {
    schemaVersion: 1 as const,
    collectionId: "local",
    key: "a".repeat(64),
    origin: { documentId: document.id, sceneId: snapshot.scene.id },
    createdAt: now,
    requestHash: "b".repeat(64),
  };
  const add: FavoriteRecord = {
    ...base,
    action: "add",
    snapshot,
    operationId: randomUUID(),
    writerId: a,
    version: { [a]: 1 },
  };
  const remove: FavoriteRecord = {
    ...base,
    action: "remove",
    operationId: randomUUID(),
    writerId: b,
    version: { [b]: 1 },
  };
  assert.equal(reduceFavorite([add, remove]), null);
  assert.equal(reduceFavorite([remove, add, add]), null);
  const restored: FavoriteRecord = {
    ...add,
    operationId: randomUUID(),
    createdAt: "2000-01-01T00:00:00.000Z",
    version: nextFavoriteVersion([add, remove], a),
  };
  for (const records of [
    [restored, add, remove],
    [remove, restored, add],
    [add, remove, restored],
  ])
    assert.equal(reduceFavorite(records)?.operationId, restored.operationId);
});
