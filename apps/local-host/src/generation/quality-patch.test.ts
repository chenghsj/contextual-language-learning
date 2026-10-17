import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { applyQualityPatch } from "./legacy/quality-patch";
import { validateTeachingBatch } from "@contextual/core";
test("quality patch replaces content and retains every unrelated field and fixed identity", () => {
  const f = pointsFixture();
  const copy = applyQualityPatch(f.raw, {
    patches: [{ path: "/utterances/1/meaning", value: "修正意思" }],
  });
  validateTeachingBatch(copy, f.input, f.request.profile, "");
  assert.equal(copy.utterances[1].meaning, "修正意思");
  assert.deepEqual(copy.points, f.raw.points);
  assert.deepEqual(copy.translations, f.raw.translations);
  assert.deepEqual(f.raw.utterances[1].meaning, "電話打來的當下，說話者已準備出門，但尚未出發。");
});
test("identity edits, prototype paths, unknown fields, duplicate patches and changed unit arrays reject", () => {
  const f = pointsFixture();
  for (const patches of [
    [{ path: "/sceneId", value: "other" }],
    [{ path: "/utterances/0/id", value: "other" }],
    [{ path: "/context/__proto__", value: {} }],
    [{ path: "/unknown", value: 1 }],
    [
      { path: "/title", value: "a" },
      { path: "/title", value: "b" },
    ],
  ])
    assert.throws(() => applyQualityPatch(f.raw, { patches }));
  assert.throws(() => applyQualityPatch(f.raw, { patches: [{ path: "/utterances", value: [] }] }));
});

test("repair can clear unnecessary basics without removing source or relaxing required fields", () => {
  const f = pointsFixture();
  const copy = applyQualityPatch(f.raw, {
    patches: [
      { path: "/utterances/0/meaning", value: "" },
      { path: "/utterances/0/contextExplanation", value: "" },
    ],
  });
  const result = validateTeachingBatch(copy, f.input, f.request.profile, "batch");
  assert.equal(result.section.utterances[0].meaning, "");
  assert.deepEqual(result.section.translations, f.raw.translations);
  assert.deepEqual(
    result.section.utterances[0].sourceSpans,
    f.input.scene.utterances[0].sourceSpans,
  );
  for (const value of [null, 3])
    assert.throws(() =>
      applyQualityPatch(f.raw, {
        patches: [{ path: "/utterances/0/meaning", value }],
      }),
    );
});
