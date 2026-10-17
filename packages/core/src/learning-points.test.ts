import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../test/learning-points-fixture";
import {
  readLearningDocument,
  validateTeachingBatch,
  validateLearningDocumentV7,
  readerScene,
  learningDocumentToMarkdown,
  compactStudyExport,
  EXPLANATION_TYPES,
  HostMessageSchema,
  HOST_PROTOCOL_VERSION,
  createSceneJob,
  JobSnapshotSchema,
} from "./index";

test("Japanese complete te-form slots cannot duplicate て in concession frames or final documents", () => {
  const f = pointsFixture();
  f.request.profile.targetLanguage = "ja";
  f.request.profile.level = "N3";
  for (const pattern of ["どんなに[動詞て形]ても", "[verb te-form] + ても", "[Vて形]ても"]) {
    f.raw.reusableItems[0].pattern = pattern;
    assert.throws(
      () => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
      /invalid_construction/,
    );
  }
  for (const pattern of ["どんなに[動詞て形]も", "[動詞て形]いても", "どんなに〜ても"]) {
    f.raw.reusableItems[0].pattern = pattern;
    assert.doesNotThrow(() => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
  }
  f.document.profile.targetLanguage = "ja";
  f.document.profile.level = "N3";
  f.document.reusableItems[0].pattern = "どんなに[動詞て形]ても";
  assert.throws(() => validateLearningDocumentV7(f.document), /invalid_construction/);
  f.request.profile.targetLanguage = "en";
  f.raw.reusableItems[0].pattern = "[動詞て形]ても";
  assert.doesNotThrow(() => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
});

test("V6 keeps three points, grammar frames without Chunks, and a point with no examples", () => {
  const { document, input } = pointsFixture();
  assert.equal(document.points.length, 3);
  assert.equal(document.reusableItems.length, 2);
  assert.equal(document.reusableItems[0].kind, "frame");
  assert.equal(document.sections[0].utterances[0].decision, "basic_only");
  assert.deepEqual(readLearningDocument(document), document);
  const view = readerScene(document, document.sections[0]);
  assert.equal(view.analyses[1].notes.length, 3);
  assert.equal(view.analyses[0].focusIndexes.length, 0);
  assert.match(learningDocumentToMarkdown(document), /Frame \(not a source quote\)/);
  assert.deepEqual(compactStudyExport(document).points, document.points);
  assert.equal(input.sourceWindow[1].originalText, "I was about to head out when you called.");
});
test("translation-only units retain complete source coverage without mandatory explanations", () => {
  for (const level of ["N1", "N3"] as const) {
    const f = pointsFixture();
    f.request.profile.targetLanguage = "ja";
    f.request.profile.level = level;
    f.raw.utterances[0].meaning = "";
    f.raw.utterances[0].contextExplanation = "";
    const result = validateTeachingBatch(f.raw, f.input, f.request.profile, "batch");
    const document = validateLearningDocumentV7({
      ...f.document,
      profile: f.request.profile,
      sections: [result.section],
      points: result.points,
      reusableItems: result.reusableItems,
    });
    assert.equal(document.sections[0].utterances.length, 2);
    assert.deepEqual(document.sections[0].translations, f.raw.translations);
    const view = readerScene(document, document.sections[0]);
    assert.equal(view.analyses.length, 1);
    assert.equal(view.analyses[0].notes.length, 3);
    assert.match(learningDocumentToMarkdown(document), /Why were you still home/);
    assert.deepEqual(readLearningDocument(document), document);
    const missingUnit = structuredClone(f.raw);
    missingUnit.utterances.shift();
    assert.throws(
      () => validateTeachingBatch(missingUnit, f.input, f.request.profile, "batch"),
      /missing_utterance/,
    );
  }
});
test("split Japanese reactions can contain no teaching while retaining source, translation and export", () => {
  for (const level of ["N1", "N3"] as const) {
    const f = pointsFixture();
    f.request.profile.targetLanguage = "ja";
    f.request.profile.level = level;
    const cue = { ...f.request.cues[0], originalText: "やった。[叫び声]" };
    f.input.sourceWindow = [cue];
    f.input.scene.dialogueCueIds = [cue.id];
    f.input.scene.utterances = [0, 1].map(i => ({
      id: "u" + (i + 1),
      cueIds: [cue.id],
      sourceSpans: [{ cueId: cue.id, start: i ? 4 : 0, end: i ? 9 : 4 }],
    }));
    f.raw.context = { text: "歓呼と叫び声の字幕。", evidenceCueIds: [cue.id] };
    f.raw.translations = [{ cueId: cue.id, text: "太好了！[喊叫聲]" }];
    f.raw.utterances = f.input.scene.utterances.map(u => ({
      id: u.id,
      meaning: "",
      contextExplanation: "",
      contextCueIds: [],
      decision: "basic_only",
      pointIds: [],
    }));
    f.raw.points = [];
    f.raw.reusableItems = [];
    const result = validateTeachingBatch(f.raw, f.input, f.request.profile, "batch");
    const doc = validateLearningDocumentV7({
      ...f.document,
      cues: [cue],
      profile: f.request.profile,
      sections: [result.section],
      points: [],
      reusableItems: [],
    });
    assert.equal(doc.sections[0].utterances.length, 2);
    assert.deepEqual(readerScene(doc, doc.sections[0]).analyses, []);
    const markdown = learningDocumentToMarkdown(doc);
    assert.ok(markdown.includes("やった。\\[叫び声\\]"));
    assert.ok(markdown.includes("太好了！\\[喊叫聲\\]"));
    assert.doesNotMatch(markdown, /### Utterance/);
    assert.deepEqual(readLearningDocument(doc), doc);
    delete f.raw.utterances[0].meaning;
    assert.throws(() => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
  }
});
test("every disabled category rejects supplementary output; all Off still gives basic reading", () => {
  for (const category of EXPLANATION_TYPES) {
    const { raw, input, request } = pointsFixture();
    request.profile.enabledExplanations = EXPLANATION_TYPES.filter(t => t !== category);
    raw.points[0].category = category;
    assert.throws(
      () => validateTeachingBatch(raw, input, request.profile, "batch"),
      /disabled_category/,
    );
  }
  const { raw, input, request } = pointsFixture();
  request.profile.enabledExplanations = [];
  raw.points = [];
  raw.reusableItems = [];
  raw.utterances.forEach((u: { decision: string; pointIds: string[] }) => {
    u.decision = "basic_only";
    u.pointIds = [];
  });
  const result = validateTeachingBatch(raw, input, request.profile, "batch");
  assert.equal(result.points.length, 0);
  assert.equal(result.section.translations.length, 2);
});
test("source, point, span, coverage and example validation reject invalid teaching", () => {
  const mutations = [
    (r: any) => r.translations.pop(),
    (r: any) => r.utterances.pop(),
    (r: any) => (r.points[0].sourceCueIds = ["invented"]),
    (r: any) => r.utterances[1].pointIds.push("unknown"),
    (r: any) => (r.points[0].sourceSpans = [{ cueId: "cue-2", start: 0, end: 9999 }]),
    (r: any) => (r.reusableItems[0].examples[0].targetText = "not in example"),
    (r: any) => (r.reusableItems[1].sourceForms[0].text = "head ... out"),
    (r: any) => (r.reusableItems[0].examples = []),
    (r: any) => (r.points[1].id = r.points[0].id),
  ];
  for (const mutate of mutations) {
    const { raw, input, request } = pointsFixture();
    mutate(raw);
    assert.throws(() => validateTeachingBatch(raw, input, request.profile, "batch"));
  }
  const { document } = pointsFixture();
  document.points[0].sourceCueIds = ["invalid"];
  assert.throws(() => validateLearningDocumentV7(document));
});
test("examples 1/2/3 keep exact count; source forms and frames have distinct targets", () => {
  for (const count of [1, 2, 3]) {
    const { raw, input, request } = pointsFixture();
    request.profile.contextualExampleCount = count;
    raw.reusableItems.forEach((item: any) => {
      const e = item.examples[0];
      item.examples = Array.from({ length: count }, (_, i) => ({
        ...e,
        situation: e.situation + i,
      }));
    });
    assert.equal(
      validateTeachingBatch(raw, input, request.profile, "batch").reusableItems[0].examples.length,
      count,
    );
  }
});
test("V4 checkpoints and protocol 11 retain version and counts", () => {
  const { request, document } = pointsFixture();
  const job = createSceneJob({ ...request, outputSchemaVersion: 7 }, 1);
  assert.equal(job.schemaVersion, 5);
  assert.equal(JobSnapshotSchema.parse(job).schemaVersion, 5);
  assert.equal(HOST_PROTOCOL_VERSION, 12);
  const message = HostMessageSchema.parse({
    id: "library",
    type: "lessons",
    lessons: [
      {
        documentId: document.id,
        title: "lesson",
        createdAt: document.createdAt,
        sourceKey: "source",
        targetLanguage: "en",
        level: "B1",
        schemaVersion: 7,
        pointCount: 3,
        reusableItemCount: 2,
      },
    ],
  });
  assert.ok(message.type === "lessons");
  assert.equal(message.lessons[0].pointCount, 3);
});

test("cross-cue utterances and discontinuous source components keep exact offsets", () => {
  const { raw, input, request } = pointsFixture();
  request.profile.enabledExplanations!.push("chunks");
  input.scene.utterances = [
    {
      id: "complete",
      cueIds: ["cue-1", "cue-2"],
      sourceSpans: input.scene.utterances.flatMap(u => u.sourceSpans),
    },
  ];
  input.requiredUtteranceIds = ["complete"];
  raw.utterances = [
    {
      ...raw.utterances[1],
      id: "complete",
      chunks: [
        {
          id: "backbone",
          spans: [
            { cueId: "cue-1", start: 0, end: 3 },
            { cueId: "cue-2", start: 2, end: 5 },
          ],
          meaning: "提問與回答的過去時間",
        },
      ],
    },
  ];
  raw.points.forEach((p: any) => (p.utteranceIds = ["complete"]));
  raw.points[0].sourceSpans = [
    { cueId: "cue-2", start: 2, end: 5 },
    { cueId: "cue-2", start: 24, end: 28 },
  ];
  const result = validateTeachingBatch(raw, input, request.profile, "batch");
  assert.deepEqual(result.section.utterances[0].cueIds, ["cue-1", "cue-2"]);
  assert.equal(result.points[0].sourceSpans?.length, 2);
});
test("reuse existing point IDs without new examples; same strings may have different points", () => {
  const { raw, input, request } = pointsFixture();
  input.existingPoints = [{ ...raw.points[0], id: "existing", utteranceIds: ["earlier"] }];
  raw.utterances[1].pointIds[0] = "existing";
  raw.points.shift();
  raw.reusableItems.shift();
  const result = validateTeachingBatch(raw, input, request.profile, "batch");
  assert.equal(result.section.utterances[1].pointIds[0], "existing");
  assert.equal(result.reusableItems.length, 1);
  raw.points.push({ ...raw.points[0], id: "different-sense", explanation: "另一情境義的獨立解說" });
  raw.utterances[1].pointIds.push("different-sense");
  assert.equal(validateTeachingBatch(raw, input, request.profile, "batch").points.length, 3);
});

test("V6 namespaces long chunk IDs once and keeps reliable readings separate from punctuation", () => {
  const { raw, input, request, document } = pointsFixture();
  request.profile.enabledExplanations!.push("chunks", "pronunciation");
  raw.utterances[0].chunks = [
    {
      id: "a".repeat(80),
      spans: [{ cueId: request.cues[0].id, start: 0, end: 3 }],
      meaning: "開頭",
    },
  ];
  const result = validateTeachingBatch(raw, input, request.profile, "scene-batch");
  document.profile = request.profile;
  document.sections = [result.section];
  document.points = result.points;
  document.reusableItems = result.reusableItems;
  assert.equal(
    validateLearningDocumentV7(document).sections[0].utterances[0].chunks?.[0].id,
    "scene-batch:" + "a".repeat(80),
  );
  request.profile.targetLanguage = "ja";
  raw.pronunciations = [
    {
      cueId: request.cues[0].id,
      segments: [{ text: request.cues[0].originalText, reading: "アレ、" }],
    },
  ];
  assert.throws(() => validateTeachingBatch(raw, input, request.profile, "batch"), /アレ、/);
});

test("a shortened exact source form reports its proven UTF-16 end without repairing or guessing", () => {
  const f = pointsFixture();
  const form = f.raw.reusableItems[0].sourceForms[0];
  const correctEnd = form.sourceSpans[0].end;
  form.sourceSpans[0].end--;
  assert.throws(
    () => validateTeachingBatch(f.raw, f.input, f.request.profile, "test"),
    new RegExp(`UTF-16 end ${correctEnd}`),
  );
  assert.equal(form.sourceSpans[0].end, correctEnd - 1);
  form.text = "unattested source";
  assert.throws(
    () => validateTeachingBatch(f.raw, f.input, f.request.profile, "test"),
    error => error instanceof Error && !error.message.includes("exact source text at this start"),
  );
});
