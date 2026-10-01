import test from "node:test";
import assert from "node:assert/strict";
import { readStudyProgress, recordSceneVisit } from "./study-progress";

test("legacy last-scene data does not claim previous scenes were studied", () => {
  assert.deepEqual(readStudyProgress({ sceneId: "c" }, ["a", "b", "c"]).visitedSceneIds, ["c"]);
  assert.equal(readStudyProgress({ sceneId: "removed" }, ["a"]).sceneId, undefined);
});
test("visits persist independently of scene order and exclude duplicates and stale IDs", () => {
  const saved = { sceneId: "c", visitedSceneIds: ["c", "c", "removed", 123] };
  const next = recordSceneVisit(saved, "a", ["a", "b", "c"], "now");
  assert.deepEqual(next, { sceneId: "a", visitedSceneIds: ["c", "a"], updatedAt: "now" });
  assert.deepEqual(recordSceneVisit(next, "a", ["a", "b", "c"], "later").visitedSceneIds, ["c", "a"]);
});
