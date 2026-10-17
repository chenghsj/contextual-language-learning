import test from "node:test";
import assert from "node:assert/strict";
import { createSceneJob } from "@contextual/core";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
test("standard jobs use only the current utterance workflow", () => {
  const { request } = pointsFixture();
  assert.equal(createSceneJob(request, 1).schemaVersion, 5);
  assert.throws(
    () => createSceneJob({ ...request, outputSchemaVersion: undefined }, 1),
    /停止支援/,
  );
});
