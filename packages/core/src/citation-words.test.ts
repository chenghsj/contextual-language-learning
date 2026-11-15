import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../test/learning-points-fixture";
import { validateTeachingBatch, validateLearningDocumentV7, readLearningDocument } from "./index";

test("new point and reusable citations reject Latin word clipping at either end", () => {
  for (const field of ["point", "form"] as const) {
    for (const range of [
      [16, 23],
      [15, 22],
    ]) {
      const f = pointsFixture();
      if (field === "point")
        f.raw.points[0].sourceSpans = [{ cueId: "cue-2", start: range[0], end: range[1] }];
      else {
        const form = f.raw.reusableItems[1].sourceForms[0];
        form.sourceSpans = [{ cueId: "cue-2", start: range[0], end: range[1] }];
        form.text = f.request.cues[1].originalText.slice(range[0], range[1]);
        const example = f.raw.reusableItems[1].examples[0];
        example.dialogue[example.targetLineIndex].text = form.text;
        example.targetText = form.text;
      }
      assert.throws(
        () => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
        /invalid_source_word/,
      );
    }
  }
});

test("whole-word citations still support affix explanations and disjoint/cross-cue evidence", () => {
  const f = pointsFixture();
  f.raw.points[0].title = "Past-tense suffix -ed in called";
  f.raw.points[0].explanation = "Explain -ed within the complete cited word called.";
  const start = f.request.cues[1].originalText.indexOf("called");
  f.raw.points[0].sourceSpans = [{ cueId: "cue-2", start, end: start + 6 }];
  assert.equal(f.request.cues[1].originalText.slice(start, start + 6), "called");
  assert.doesNotThrow(() => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
  // A point may reference more than one complete assigned utterance/cue.
  f.raw.utterances[0].decision = "explained";
  f.raw.utterances[0].pointIds = [f.raw.points[0].id];
  f.raw.points[0].utteranceIds = f.input.requiredUtteranceIds;
  f.raw.points[0].sourceCueIds = ["cue-1", "cue-2"];
  f.raw.points[0].sourceSpans = [
    { cueId: "cue-1", start: 0, end: 3 },
    { cueId: "cue-2", start, end: start + 6 },
  ];
  assert.doesNotThrow(() => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
});

test("apostrophes, hyphens and already standalone affixes remain valid citation boundaries", () => {
  for (const [source, word] of [
    ["l’armoire", "armoire"],
    ["es-tu", "tu"],
    ["suffix -ing", "ing"],
    ["cafe\u0301 dehors", "dehors"],
  ]) {
    const f = pointsFixture();
    const text = f.request.cues[1].originalText;
    f.request.cues[1].originalText = source;
    f.input.scene.utterances[1].sourceSpans = [{ cueId: "cue-2", start: 0, end: source.length }];
    f.raw.reusableItems = [];
    for (const point of f.raw.points)
      point.sourceSpans = [
        { cueId: "cue-2", start: source.indexOf(word), end: source.indexOf(word) + word.length },
      ];
    assert.doesNotThrow(
      () => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
      text,
    );
  }
});

test("fresh final graphs reject clipped citations, historical and mixed resumed graphs remain readable", () => {
  const f = pointsFixture();
  f.document.points[0].sourceSpans = [{ cueId: "cue-2", start: 0, end: 36 }];
  assert.throws(() => validateLearningDocumentV7(f.document), /invalid_source_word/);
  const old = structuredClone(f.document);
  old.execution = {
    ...old.execution!,
    promptVersion: "learning-points-prompts-18",
    qualityStrategyVersion: "program-validation-2",
  };
  const original = JSON.stringify(old);
  assert.deepEqual(readLearningDocument(old), old);
  assert.equal(JSON.stringify(old), original);
  const resumed = structuredClone(f.document);
  resumed.execution!.previousExecution = old.execution;
  assert.doesNotThrow(() => validateLearningDocumentV7(resumed));
});

test("the observed French citation fails at 31 and preserves dehors at 32", () => {
  const f = pointsFixture();
  const source = "Pourquoi êtes-vous encore dehors ?";
  f.request.profile.targetLanguage = "fr";
  f.request.cues[1].originalText = source;
  f.input.scene.utterances[1].sourceSpans = [{ cueId: "cue-2", start: 0, end: source.length }];
  f.raw.reusableItems = [];
  for (const point of f.raw.points)
    point.sourceSpans = [{ cueId: "cue-2", start: 0, end: source.length }];
  f.raw.points[0].sourceSpans[0].end = 31;
  assert.throws(
    () => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
    /invalid_source_word/,
  );
  f.raw.points[0].sourceSpans[0].end = 32;
  assert.doesNotThrow(() => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
});
