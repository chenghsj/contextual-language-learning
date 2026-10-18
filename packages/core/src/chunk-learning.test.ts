import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../test/learning-points-fixture";
import {
  validateTeachingBatch,
  prepareTeachingBatch,
  readLearningDocument,
  readerScene,
  exactChunkIds,
  learningDocumentToMarkdown,
  compactStudyExport,
} from "./index";

test("new teaching requires presentation; legacy documents retain all old examples unchanged", () => {
  const { raw, input, request, document } = pointsFixture();
  delete raw.points[0].presentation;
  assert.throws(
    () => validateTeachingBatch(raw, input, request.profile, "batch"),
    /missing_presentation/,
  );
  document.profile.contextualExampleCount = 3;
  document.points.forEach(p => delete p.presentation);
  document.reusableItems.forEach(item => {
    item.examples = Array.from({ length: 3 }, (_, i) => ({
      ...structuredClone(item.examples[0]),
      situation: `舊例句 ${i}`,
    }));
  });
  const before = JSON.stringify(document);
  const restored = readLearningDocument(JSON.parse(before));
  assert.equal(JSON.stringify(document), before);
  assert.deepEqual(restored, JSON.parse(before));
  assert.equal(
    readerScene(restored, restored.sections[0]).analyses[1].notes[0].presentation,
    "core",
  );
  assert.equal(compactStudyExport(restored).schemaVersion, 7);
  assert.match(learningDocumentToMarkdown(restored), /舊例句 2/);
});

test("strict chunk guards reject punctuation, whitespace, overlaps, bounds and Unicode splitting", () => {
  for (const spans of [
    [{ cueId: "cue-2", start: 39, end: 40 }], // punctuation
    [{ cueId: "cue-2", start: 1, end: 2 }], // space
    [{ cueId: "cue-2", start: 0, end: 1000 }],
    [
      { cueId: "cue-2", start: 0, end: 5 },
      { cueId: "cue-2", start: 3, end: 8 },
    ],
  ]) {
    const { raw, input, request } = pointsFixture();
    request.profile.enabledExplanations!.push("chunks");
    raw.utterances[1].chunks = [{ id: "bad", meaning: "不可靠", spans }];
    assert.throws(() => validateTeachingBatch(raw, input, request.profile, "batch"));
  }
  const { raw, input, request } = pointsFixture();
  request.profile.enabledExplanations!.push("chunks");
  input.sourceWindow[0].originalText = "𠮷野。";
  raw.utterances[0].chunks = [
    { id: "unicode", meaning: "人名", spans: [{ cueId: "cue-1", start: 0, end: 1 }] },
  ];
  assert.throws(
    () => validateTeachingBatch(raw, input, request.profile, "batch"),
    /span|Unicode|surrogate/i,
  );
  delete raw.utterances[0].chunks;
  assert.doesNotThrow(() => validateTeachingBatch(raw, input, request.profile, "batch"));
});

test("reader preserves IDs and presentation, deduplicates, and associates only exact discontinuous spans", () => {
  const { document } = pointsFixture();
  const utterance = document.sections[0].utterances[1];
  const spans = [
    { cueId: "cue-2", start: 2, end: 5 },
    { cueId: "cue-2", start: 24, end: 28 },
  ];
  utterance.chunks = [{ id: "relation", meaning: "時間關係", spans }];
  document.points[0].sourceSpans = [...spans].reverse();
  document.points[0].presentation = "extended";
  document.points[1].sourceSpans = [{ cueId: "cue-2", start: 2, end: 5 }];
  utterance.pointIds.push(utterance.pointIds[0]);
  const view = readerScene(document, document.sections[0]);
  const analysis = view.analyses[1];
  assert.equal(analysis.notes.length, 3);
  assert.equal(analysis.notes[0].id, document.points[0].id);
  assert.equal(analysis.notes[0].presentation, "extended");
  assert.deepEqual(analysis.notes[0].sourceSpans, document.points[0].sourceSpans);
  assert.deepEqual(analysis.notes[0].chunkIds, ["relation"]);
  assert.deepEqual(analysis.notes[1].chunkIds, []);
  assert.deepEqual(analysis.itemChunkIds[0], ["relation"]);
  assert.deepEqual(analysis.itemChunkIds[1], []);
  assert.deepEqual(exactChunkIds(undefined, utterance.chunks), []);
});

test("necessary points need no extensions or reusable items; exactly one example is enforced for new standard teaching", () => {
  const { raw, input, request } = pointsFixture();
  raw.reusableItems = [];
  assert.equal(validateTeachingBatch(raw, input, request.profile, "batch").reusableItems.length, 0);
  const next = pointsFixture();
  next.raw.reusableItems[0].examples.push(structuredClone(next.raw.reusableItems[0].examples[0]));
  assert.throws(
    () => validateTeachingBatch(next.raw, next.input, next.request.profile, "batch"),
    /example_count|example count|examples/i,
  );
});

test("new chunks cannot cut inside Japanese words or Korean inflected words", () => {
  for (const [language, text, start, end] of [
    ["ja", "これならいける。", 4, 5],
    ["ko", "같이 가기로 했어요?", 1, 2],
  ] as const) {
    const { raw, input, request } = pointsFixture();
    request.profile.targetLanguage = language;
    request.profile.enabledExplanations!.push("chunks");
    input.sourceWindow[0].originalText = text;
    raw.utterances[0].chunks = [
      { id: "inside-word", meaning: "誤切分", spans: [{ cueId: "cue-1", start, end }] },
    ];
    assert.throws(
      () => validateTeachingBatch(raw, input, request.profile, "batch"),
      /invalid_chunk.*cuts inside/,
    );
    delete raw.utterances[0].chunks;
    assert.doesNotThrow(() => validateTeachingBatch(raw, input, request.profile, "batch"));
  }
});

test("Host omits unreliable optional chunks while preserving validated whole-utterance content", () => {
  const { raw, input, request } = pointsFixture();
  request.profile.enabledExplanations!.push("chunks");
  raw.utterances[1].chunks = [
    { id: "punctuation", meaning: "unreliable", spans: [{ cueId: "cue-2", start: 39, end: 40 }] },
  ];
  const before = JSON.stringify(raw);
  const prepared = prepareTeachingBatch(raw, input, request.profile, "batch");
  assert.deepEqual(prepared.omittedChunkUtteranceIds, [raw.utterances[1].id]);
  assert.equal(prepared.safeOutput.utterances[1].chunks, undefined);
  assert.equal(prepared.safeOutput.utterances[1].meaning, raw.utterances[1].meaning);
  assert.deepEqual(prepared.safeOutput.points, raw.points);
  assert.deepEqual(prepared.safeOutput.reusableItems, raw.reusableItems);
  assert.equal(JSON.stringify(raw), before);
  delete raw.points[0].presentation;
  assert.throws(
    () => prepareTeachingBatch(raw, input, request.profile, "batch"),
    /missing_presentation/,
  );
});

test("one invalid chunk preserves reliable clickable fragments in the same and other utterances", () => {
  const { raw, input, request } = pointsFixture();
  request.profile.enabledExplanations!.push("chunks");
  const first = {
    id: "question",
    meaning: "為何仍在家",
    spans: [{ cueId: "cue-1", start: 0, end: 24 }],
  };
  const second = {
    id: "preparing",
    meaning: "正準備出門",
    spans: [{ cueId: "cue-2", start: 0, end: 23 }],
  };
  raw.utterances[0].chunks = [first];
  raw.utterances[1].chunks = [
    { id: "bad-offset", meaning: "錯誤位置", spans: [{ cueId: "cue-2", start: 24, end: 1000 }] },
    second,
  ];
  const before = structuredClone(raw);
  const prepared = prepareTeachingBatch(raw, input, request.profile, "batch");
  assert.deepEqual(prepared.safeOutput.utterances[0].chunks, [first]);
  assert.deepEqual(prepared.safeOutput.utterances[1].chunks, [second]);
  assert.deepEqual(prepared.omittedChunkUtteranceIds, [raw.utterances[1].id]);
  assert.deepEqual(raw, before);
  assert.doesNotThrow(() =>
    validateTeachingBatch(prepared.safeOutput, input, request.profile, "batch"),
  );
});

test("explicitly unclear source names lose guessed readings without losing reliable adjacent annotations or making another model call", () => {
  const { raw, input, request } = pointsFixture();
  request.profile.targetLanguage = "ja";
  request.profile.enabledExplanations!.push("pronunciation");
  input.sourceWindow[0].originalText = "休みも友達も。";
  raw.translations[0].text = "「休み」（名稱或所指未明）也是、朋友也是。";
  raw.pronunciations = [
    {
      cueId: "cue-1",
      segments: [
        { text: "休み", reading: "やすみ" },
        { text: "も" },
        { text: "友達", reading: "ともだち" },
        { text: "も。" },
      ],
    },
  ];
  const before = JSON.stringify(raw);
  const prepared = prepareTeachingBatch(raw, input, request.profile, "batch");
  assert.equal(prepared.safeOutput.pronunciations![0].segments[0].reading, undefined);
  assert.equal(prepared.safeOutput.pronunciations![0].segments[2].reading, "ともだち");
  assert.equal(prepared.targets.length, 0);
  assert.equal(prepared.diagnostics[0].action, "omitted");
  assert.equal(JSON.stringify(raw), before);
  raw.translations[0].text = "休假和朋友。";
  assert.equal(
    prepareTeachingBatch(raw, input, request.profile, "batch").safeOutput.pronunciations![0]
      .segments[0].reading,
    "やすみ",
  );
});
