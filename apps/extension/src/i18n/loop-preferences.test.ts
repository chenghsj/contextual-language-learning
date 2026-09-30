import assert from "node:assert/strict";
import test from "node:test";
import { restoreLoopPreferences } from "../lib/loop-preferences";

test("existing sentence preferences seed new scene preferences on first load", () => {
  assert.deepEqual(restoreLoopPreferences({ repeat: "5", delay: 2 }), {
    repeat: "5", delay: 2, sceneRepeat: "5", sceneDelay: 2,
  });
});

test("scene and sentence preferences remain independent across lessons", () => {
  const stored = { repeat: "2", delay: 0, sceneRepeat: "infinite", sceneDelay: 3 };
  assert.deepEqual(restoreLoopPreferences(stored), stored);
  assert.deepEqual(restoreLoopPreferences({ ...stored, repeat: "5", delay: 1 }), {
    repeat: "5", delay: 1, sceneRepeat: "infinite", sceneDelay: 3,
  });
});

test("invalid storage values fall back without sending invalid loop settings to a player", () => {
  assert.deepEqual(restoreLoopPreferences({ repeat: "9", delay: -1, sceneRepeat: "x", sceneDelay: 8 }), {
    repeat: "3", delay: 1, sceneRepeat: "3", sceneDelay: 1,
  });
});
