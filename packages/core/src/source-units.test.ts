import test from "node:test";
import assert from "node:assert/strict";
import {
  validateUnitCoverage,
  atomicUnitGroups,
  assertAtomicUnitSplit,
  graphemeBoundaries,
} from "./source-units";
import {
  validateCandidate,
  validateTeachingBatch,
  validateLearningDocumentV7,
} from "./learning-points";
import { pointsFixture } from "../test/learning-points-fixture";

test("within-cue topics and across-cue utterances fully cover immutable UTF-16 text", () => {
  const f = pointsFixture(),
    cue = f.request.cues[1],
    at = cue.originalText.indexOf(" when");
  const units = [
    f.input.scene.utterances[0],
    { id: "a", cueIds: [cue.id], sourceSpans: [{ cueId: cue.id, start: 0, end: at }] },
    {
      id: "b",
      cueIds: [cue.id],
      sourceSpans: [{ cueId: cue.id, start: at, end: cue.originalText.length }],
    },
  ];
  validateUnitCoverage(units, f.input.scene.dialogueCueIds, f.request.cues);
  assert.deepEqual(atomicUnitGroups(units), [["u1"], ["a", "b"]]);
  assert.throws(() => assertAtomicUnitSplit([["u1", "a"], ["b"]], units), /Shared subtitle/);
  const candidate = { ...f.input.scene, utterances: units };
  validateCandidate(
    candidate,
    f.request.cues.map(c => c.id),
    f.request.cues,
    f.request.profile,
  );
  f.input.scene = candidate;
  f.input.requiredUtteranceIds = units.map(u => u.id);
  f.raw.utterances = [
    f.raw.utterances[0],
    ...["a", "b"].map(id => ({
      id,
      meaning: id,
      contextExplanation: "",
      contextCueIds: [],
      decision: "basic_only",
      pointIds: [],
    })),
  ];
  f.raw.points = [];
  f.raw.reusableItems = [];
  const result = validateTeachingBatch(f.raw, f.input, f.request.profile, "");
  assert.equal(result.section.translations.length, 2);
  assert.equal(result.section.utterances.length, 3);
  validateLearningDocumentV7({
    ...f.document,
    sections: [result.section],
    points: [],
    reusableItems: [],
  });
});
test("combining marks, ZWJ emoji, regional flags and no-space scripts cannot be bisected", () => {
  for (const text of ["e\u0301X", "👨‍👩‍👧‍👦你好", "🇹🇼ไทย", "한\u0301글"]) {
    const cue = { id: "c", originalText: text, startMs: 0, endMs: 1000 };
    const bounds = graphemeBoundaries(text);
    for (let cut = 1; cut < text.length; cut++) {
      const units = [
        { id: "a", cueIds: ["c"], sourceSpans: [{ cueId: "c", start: 0, end: cut }] },
        { id: "b", cueIds: ["c"], sourceSpans: [{ cueId: "c", start: cut, end: text.length }] },
      ];
      if (bounds.has(cut)) validateUnitCoverage(units, ["c"], [cue]);
      else assert.throws(() => validateUnitCoverage(units, ["c"], [cue]), /grapheme/);
    }
  }
});
test("gap, overlap, duplicate cue reference and point outside associated unit are rejected", () => {
  const f = pointsFixture();
  for (const mutate of [
    (u: any) => u[0].sourceSpans[0].start++,
    (u: any) => u[0].sourceSpans[0].end--,
    (u: any) => u.reverse(),
  ]) {
    const units = structuredClone(f.input.scene.utterances);
    mutate(units);
    assert.throws(() => validateUnitCoverage(units, f.input.scene.dialogueCueIds, f.request.cues));
  }
  f.input.scene.utterances[1].sourceSpans = [{ cueId: "cue-2", start: 0, end: 10 }];
  assert.throws(
    () => validateTeachingBatch(f.raw, f.input, f.request.profile, ""),
    /outside associated/,
  );
});

test("reusable frames can cite discontinuous components across nonadjacent subtitles", () => {
  const f = pointsFixture();
  const cues = [
    { id: "a", originalText: "I put", startMs: 0, endMs: 1000 },
    { id: "b", originalText: "the book", startMs: 1000, endMs: 2000 },
    { id: "c", originalText: "away.", startMs: 2000, endMs: 3000 },
  ];
  const spans = [
    { cueId: "a", start: 2, end: 5 },
    { cueId: "c", start: 0, end: 4 },
  ];
  f.input.sourceWindow = cues;
  f.input.scene.dialogueCueIds = cues.map(c => c.id);
  f.input.scene.utterances = [
    {
      id: "u",
      cueIds: cues.map(c => c.id),
      sourceSpans: cues.map(c => ({ cueId: c.id, start: 0, end: c.originalText.length })),
    },
  ];
  f.input.requiredUtteranceIds = ["u"];
  const raw = {
    status: "complete",
    risks: [],
    sceneId: f.input.scene.id,
    title: "Put something away",
    context: { text: "Something is put away.", evidenceCueIds: ["a", "b", "c"] },
    translations: cues.map(c => ({ cueId: c.id, text: c.originalText })),
    utterances: [
      {
        id: "u",
        meaning: "把書收起來。",
        contextExplanation: "",
        contextCueIds: [],
        decision: "explained",
        pointIds: ["p"],
      },
    ],
    points: [
      {
        id: "p",
        utteranceIds: ["u"],
        category: "grammar",
        presentation: "core",
        title: "put something away",
        sourceCueIds: ["a", "c"],
        sourceSpans: spans,
        contextCueIds: [],
        explanation: "把某物收起來；物件可置於 put 與 away 之間。",
      },
    ],
    reusableItems: [
      {
        id: "r",
        pointIds: ["p"],
        kind: "frame",
        sourceForms: [{ cueIds: ["a", "c"], sourceSpans: spans, text: "put away" }],
        pattern: "put [object] away",
        examples: [
          {
            origin: "ai",
            situation: "收外套",
            dialogue: [
              { text: "Can I put my jacket away?", translation: "我可以把外套收起來嗎？" },
              { text: "Yes, please.", translation: "可以，請收起來。" },
            ],
            targetLineIndex: 0,
            targetText: "put my jacket away",
          },
        ],
      },
    ],
  };
  const result = validateTeachingBatch(raw, f.input, f.request.profile, "");
  validateLearningDocumentV7({
    ...f.document,
    cues,
    sections: [result.section],
    points: result.points,
    reusableItems: result.reusableItems,
  });
  assert.deepEqual(result.reusableItems[0].sourceForms[0].cueIds, ["a", "c"]);
});
