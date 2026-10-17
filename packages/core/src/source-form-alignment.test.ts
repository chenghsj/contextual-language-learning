import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../test/learning-points-fixture";
import { prepareTeachingBatch, validateTeachingBatch } from "./index";
const prepare = (f: ReturnType<typeof pointsFixture>) =>
  prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
test("unique verbatim form repairs only range metadata and linked exact citations, without mutating raw or fixed units", () => {
  const f = pointsFixture();
  const form = f.raw.reusableItems[1].sourceForms[0];
  form.sourceSpans = [{ cueId: "cue-2", start: 16, end: 24 }];
  f.raw.points[1].sourceSpans = structuredClone(form.sourceSpans);
  f.raw.risks = [
    {
      type: "construction_example",
      unitId: "u2",
      path: "/points/1/explanation",
      description: "Check this target",
      sourceSpans: structuredClone(form.sourceSpans),
    },
  ];
  const before = structuredClone(f.raw),
    units = structuredClone(f.input.scene.utterances);
  assert.throws(
    () => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
    /invalid_source_reference/,
  );
  const result = prepare(f);
  assert.deepEqual(result.output.reusableItems[1].sourceForms[0].sourceSpans, [
    { cueId: "cue-2", start: 15, end: 23 },
  ]);
  assert.deepEqual(
    result.output.points[1].sourceSpans,
    result.output.reusableItems[1].sourceForms[0].sourceSpans,
  );
  assert.deepEqual(result.output.risks[0].sourceSpans, result.output.points[1].sourceSpans);
  assert.equal(result.sourceSpanCorrections.length, 1);
  assert.deepEqual(f.raw, before);
  assert.deepEqual(f.input.scene.utterances, units);
  assert.deepEqual(result.output.translations, before.translations);
  assert.deepEqual(result.output.utterances, before.utterances);
});
test("correct ranges are unchanged; repeated forms and unrelated cue identities are never guessed", () => {
  const f = pointsFixture();
  assert.equal(prepare(f).sourceSpanCorrections.length, 0);
  f.input.sourceWindow[1].originalText += " head out.";
  f.input.scene.utterances[1].sourceSpans[0].end = f.input.sourceWindow[1].originalText.length;
  f.raw.reusableItems[1].sourceForms[0].sourceSpans = [{ cueId: "cue-2", start: 16, end: 24 }];
  assert.throws(() => prepare(f), /invalid_source_reference/);
  const other = pointsFixture();
  other.raw.reusableItems[1].sourceForms[0].sourceSpans = [{ cueId: "cue-1", start: 0, end: 8 }];
  assert.throws(() => prepare(other), /source|cue/i);
});
test("alignment respects Unicode grapheme boundaries and never repairs existing documents", () => {
  const f = pointsFixture();
  const source = "I order cafe\u0301 now.";
  f.input.sourceWindow[1].originalText = source;
  f.input.scene.utterances[1].sourceSpans[0].end = source.length;
  f.raw.points = [f.raw.points[1]];
  f.raw.points[0].sourceSpans = [{ cueId: "cue-2", start: 0, end: source.length }];
  f.raw.utterances[1].pointIds = ["p2"];
  f.raw.reusableItems = [f.raw.reusableItems[1]];
  const item = f.raw.reusableItems[0],
    form = item.sourceForms[0];
  form.text = "cafe\u0301";
  const start = source.indexOf(form.text);
  form.sourceSpans = [{ cueId: "cue-2", start: start + 1, end: start + form.text.length + 1 }];
  const example = item.examples[0];
  example.targetText = form.text;
  example.dialogue[example.targetLineIndex].text = form.text;
  const result = prepare(f);
  assert.deepEqual(result.output.reusableItems[0].sourceForms[0].sourceSpans, [
    { cueId: "cue-2", start, end: start + form.text.length },
  ]);
  form.text = "\u0301";
  form.sourceSpans = [{ cueId: "cue-2", start: 0, end: 1 }];
  example.targetText = form.text;
  example.dialogue[example.targetLineIndex].text = form.text;
  assert.throws(() => prepare(f), /source|grapheme/i);
});
test("overlapping literal occurrences remain ambiguous", () => {
  const f = pointsFixture();
  f.input.sourceWindow[1].originalText = "aaaa.";
  f.input.scene.utterances[1].sourceSpans[0].end = 5;
  f.raw.points = [f.raw.points[1]];
  f.raw.points[0].sourceSpans = [{ cueId: "cue-2", start: 0, end: 5 }];
  f.raw.utterances[1].pointIds = ["p2"];
  f.raw.reusableItems = [f.raw.reusableItems[1]];
  const item = f.raw.reusableItems[0];
  item.sourceForms[0].text = "aaa";
  item.sourceForms[0].sourceSpans = [{ cueId: "cue-2", start: 2, end: 5 }];
  const example = item.examples[0];
  example.targetText = "aaa";
  example.dialogue[example.targetLineIndex].text = "aaa";
  assert.throws(() => prepare(f), /invalid_source_reference/);
});
