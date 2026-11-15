import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import type { CompactPlan, CompactQualityReview } from "@contextual/core";
import {
  applyCompactQualityReview,
  compactQualityHash,
  compactQualityPrompt,
  readCompactRecheck,
} from "./compact-quality";

function fixture() {
  const f = pointsFixture();
  const { id, dialogueCueIds, contextCueIds, learningValue } = f.input.scene;
  const plan: CompactPlan = {
    revision: 1,
    windows: [{ id: "window-0", cueIds: f.request.cues.map(c => c.id) }],
    scenes: [
      {
        source: { id, dialogueCueIds, contextCueIds, learningValue },
        result: { ...f.result, sourceUnits: f.input.scene.utterances, diagnostics: [] },
      },
    ],
  };
  const review = (path: string, value: unknown): CompactQualityReview => ({
    issues: [
      {
        severity: "error",
        type: "mistranslation",
        path,
        sourceSpans: [{ cueId: f.request.cues[0].id, start: 0, end: 1 }],
        description: "Reviewed source error.",
      },
    ],
    patches: [{ path, value }],
  });
  return { ...f, plan, review };
}
test("audit input retains all teaching and readings while omitting repeated coverage and Host diagnostics", () => {
  const f = fixture();
  const data = JSON.parse(
    compactQualityPrompt(f.request, f.plan, 32768).split("Quoted data:\n")[1],
  );
  const result = f.plan.scenes![0].result!;
  assert.deepEqual(
    data.scenes,
    JSON.parse(
      JSON.stringify([
        { section: result.section, points: result.points, reusableItems: result.reusableItems },
      ]),
    ),
  );
  const ids = new Set([
    ...f.plan.scenes![0].source.dialogueCueIds,
    ...f.plan.scenes![0].source.contextCueIds,
  ]);
  assert.deepEqual(
    data.source,
    JSON.parse(JSON.stringify(f.request.cues.filter(c => ids.has(c.id)))),
  );
  assert.equal(data.scenes[0].sourceUnits, undefined);
  assert.equal(data.scenes[0].diagnostics, undefined);
});
test("source identity claims are highlighted without rewriting or judging the draft", () => {
  const f = fixture();
  f.plan.scenes![0].result!.points[0].explanation = "將英雄名更正為日常名字。";
  const before = structuredClone(f.plan);
  const data = JSON.parse(
    compactQualityPrompt(f.request, f.plan, 32768).split("Quoted data:\n")[1],
  );
  assert.deepEqual(data.riskHints, [
    {
      path: "/scenes/0/points/0/explanation",
      kind: "verify_identity_mapping_against_explicit_source",
    },
  ]);
  assert.deepEqual(f.plan, before);
});
test("frozen v1 uses its original full-data review while new v2 keeps the semantic risk pass", () => {
  const f = fixture();
  const old = compactQualityPrompt(f.request, f.plan, 8192, false, "compact-source-review-1");
  const current = compactQualityPrompt(f.request, f.plan, 8192);
  const read = (text: string) => JSON.parse(text.split("Quoted data:\n")[1]);
  assert.deepEqual(read(old).scenes, JSON.parse(JSON.stringify(f.plan.scenes!.map(s => s.result))));
  assert.equal(read(old).riskHints, undefined);
  assert.deepEqual(read(current).scenes[0].points, read(old).scenes[0].points);
  assert.equal(read(current).scenes[0].sourceUnits, undefined);
  assert.match(old, /Output budget in tokens: 8192/);
});
test("review patches preserve source, IDs, references and the original draft", () => {
  const f = fixture(),
    before = structuredClone(f.plan);
  const path = "/scenes/0/section/translations/0/text";
  const results = applyCompactQualityReview(f.review(path, "修正後的翻譯"), f.request, f.plan);
  assert.deepEqual(f.plan, before);
  const expected = structuredClone(before.scenes![0].result!);
  expected.section.translations[0].text = "修正後的翻譯";
  assert.deepEqual(results, [expected]);
  const hash = compactQualityHash(f.request, f.plan);
  f.plan.scenes![0].result = results[0];
  assert.notEqual(compactQualityHash(f.request, f.plan), hash);
});
test("review cannot edit protected fields, unknown paths or prototypes", () => {
  const f = fixture();
  for (const [path, value] of [
    ["/scenes/0/sourceUnits/0/id", "other"],
    ["/scenes/0/section/cueIds/0", "other"],
    ["/scenes/0/points/0/sourceSpans/0/end", 1],
    ["/scenes/0/reusableItems/0/kind", "frame"],
    ["/scenes/0/section/translations/99/text", "other"],
    ["/scenes/0/section/constructor/prototype/text", "other"],
  ] as const)
    assert.throws(() => applyCompactQualityReview(f.review(path, value), f.request, f.plan));
});
test("whole-example repairs are validated against the unchanged item and example count", () => {
  const f = fixture(),
    path = "/scenes/0/reusableItems/0/examples/0";
  const example = structuredClone(f.result.reusableItems[0].examples[0]);
  example.situation = "修正後的例句情境";
  const result = applyCompactQualityReview(f.review(path, example), f.request, f.plan);
  assert.equal(result[0].reusableItems[0].examples[0].situation, example.situation);
  assert.deepEqual(result[0].reusableItems[0].sourceForms, f.result.reusableItems[0].sourceForms);
  assert.throws(() =>
    applyCompactQualityReview(
      f.review(path, { ...example, targetText: "not in example" }),
      f.request,
      f.plan,
    ),
  );
  assert.throws(() => applyCompactQualityReview(f.review(path, []), f.request, f.plan));
});
test("patches require real scene evidence and a unique reported error, not a style warning", () => {
  const f = fixture(),
    path = "/scenes/0/section/translations/0/text";
  const r = f.review(path, "修正");
  assert.throws(() =>
    applyCompactQualityReview({ ...r, patches: [...r.patches, ...r.patches] }, f.request, f.plan),
  );
  assert.throws(() =>
    applyCompactQualityReview({ issues: [], patches: r.patches }, f.request, f.plan),
  );
  const warning = {
    ...r,
    issues: [{ ...r.issues[0], severity: "warning" as const, type: "style" as const }],
  };
  assert.throws(() => applyCompactQualityReview(warning, f.request, f.plan));
  r.issues[0].sourceSpans[0].cueId = "unknown";
  assert.throws(() => applyCompactQualityReview(r, f.request, f.plan));
  assert.throws(() => readCompactRecheck({ issues: [], patches: [] }, f.request, f.plan));
});
