import assert from "node:assert/strict";
import test from "node:test";
import { nextStudyStep, readSceneProgress, STUDY_STEPS } from "../components/scene-navigation";

test("the three study steps have a clear order without advancing the scene", () => {
  assert.deepEqual(STUDY_STEPS, ["listen", "understand", "practice"]);
  assert.equal(nextStudyStep("listen"), "understand");
  assert.equal(nextStudyStep("understand"), "practice");
  assert.equal(nextStudyStep("practice"), null);
});

test("reopening a lesson restores the selected scene and a different stage for each scene", () => {
  const progress = readSceneProgress({
    sceneId: "scene-b", completedIds: ["scene-a", "scene-a"],
    steps: { "scene-a": "practice", "scene-b": "understand" },
  }, ["scene-a", "scene-b", "scene-c"]);
  assert.deepEqual(progress, {
    sceneId: "scene-b", completedIds: ["scene-a"],
    steps: { "scene-a": "practice", "scene-b": "understand" },
  });
  assert.equal(progress.steps["scene-c"] ?? "listen", "listen");
});

test("legacy progress, invalid steps and stale scene IDs do not corrupt the reader", () => {
  assert.deepEqual(readSceneProgress({ sceneId: "a", completedIds: ["a"] }, ["a", "b"]), {
    sceneId: "a", completedIds: ["a"], steps: {},
  });
  assert.deepEqual(readSceneProgress({
    sceneId: "old", completedIds: ["old", "b", 42],
    steps: { old: "practice", a: "unknown", b: "listen" },
  }, ["a", "b"]), {
    sceneId: null, completedIds: ["b"], steps: { b: "listen" },
  });
  assert.deepEqual(readSceneProgress(null, ["a"]), {
    sceneId: null, completedIds: [], steps: {},
  });
});
