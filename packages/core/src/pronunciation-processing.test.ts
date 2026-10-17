import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture, withReadingDiagnostics } from "../test/learning-points-fixture";
import {
  prepareTeachingBatch,
  applyPronunciationRepair,
  validateTeachingBatch,
  LEARNING_LANGUAGES,
  readLearningDocument,
  learningDocumentToMarkdown,
  pronunciationMissingCount,
} from "./index";
function fixture(language: any = "ja", reading = "メッセージ") {
  const f = pointsFixture();
  f.request.profile.targetLanguage = language;
  f.request.profile.enabledExplanations!.push("pronunciation");
  f.raw.pronunciations = [
    { cueId: f.request.cues[0].id, segments: [{ text: f.request.cues[0].originalText, reading }] },
  ];
  return f;
}
test("canonicalize Japanese readings without changing evidence; strict document validation stays strict", () => {
  const f = fixture("ja", "  メッセージヾヽ  ");
  const before = structuredClone(f.raw);
  const r = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
  assert.equal(r.output.pronunciations![0].segments[0].reading, "めっせーじゞゝ");
  assert.deepEqual(f.raw, before);
  assert.deepEqual(r.output.translations, before.translations);
  assert.deepEqual(r.output.utterances, before.utterances);
  assert.equal(r.targets.length, 0);
  assert.equal(r.diagnostics[0].action, "normalized");
  assert.throws(
    () => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
    /writing system/,
  );
});
test("only bad readings are omitted, while alignment and references remain fatal", () => {
  for (const reading of ["ﾒｯｾｰｼﾞ", "message", "漢字", ""]) {
    const f = fixture("ja", reading);
    const r = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
    assert.equal(r.targets.length, 1);
    assert.equal(r.safeOutput.pronunciations, undefined);
    validateTeachingBatch(r.safeOutput, f.input, f.request.profile, "batch");
    for (const mutate of [
      (raw: any) => (raw.pronunciations[0].cueId = "fake"),
      (raw: any) => (raw.pronunciations[0].segments[0].text = "changed"),
      (raw: any) => raw.translations.pop(),
      (raw: any) => raw.utterances.pop(),
    ]) {
      const invalid = structuredClone(f.raw);
      mutate(invalid);
      assert.throws(() => prepareTeachingBatch(invalid, f.input, f.request.profile, "batch"));
    }
  }
  const f = fixture();
  f.raw.pronunciations[0].segments = [
    { text: "Why ", reading: "あれ" },
    { text: "were you still home?", reading: "bad" },
  ];
  const r = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
  assert.equal(r.safeOutput.pronunciations![0].segments[0].reading, "あれ");
  assert.equal(r.safeOutput.pronunciations![0].segments[1].reading, undefined);
});
test("all fourteen language formats and example annotations use the same processing", () => {
  for (const language of LEARNING_LANGUAGES) {
    const good =
      language === "ja"
        ? "アレ"
        : language === "ko"
          ? "한"
          : language === "zh-TW"
            ? "ㄒㄩㄝˊ ㄒㄧˊ"
            : language === "zh-CN"
              ? "xué xí"
              : "/a/";
    const f = fixture(language, good);
    const line = f.raw.reusableItems[0].examples[0].dialogue[0];
    line.pronunciation = [{ text: line.text, reading: good }];
    const r = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
    assert.equal(r.targets.length, 0);
    assert.equal(
      r.output.pronunciations![0].segments[0].reading,
      language === "ja" ? "あれ" : language === "ko" ? "한" : good,
    );
    line.pronunciation[0].reading = "[a]";
    f.raw.pronunciations[0].segments[0].reading = "漢字";
    const bad = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
    assert.equal(bad.targets.length, 2);
    assert.equal(bad.safeOutput.reusableItems[0].examples[0].dialogue[0].pronunciation, undefined);
  }
});
test("empty punctuation readings normalize without repair across languages; empty word readings remain pending", () => {
  for (const language of LEARNING_LANGUAGES) {
    const reading =
      language === "ja"
        ? "あれ"
        : language === "ko"
          ? "한"
          : language === "zh-TW"
            ? "ㄚ"
            : language === "zh-CN"
              ? "ā"
              : "/a/";
    const f = fixture(language, reading);
    const source = f.request.cues[0].originalText;
    f.raw.pronunciations[0].segments = [
      { text: source.slice(0, -1), reading },
      { text: source.slice(-1), reading: " " },
    ];
    const line = f.raw.reusableItems[0].examples[0].dialogue[0];
    line.pronunciation = [
      { text: line.text.slice(0, -1), reading },
      { text: line.text.slice(-1), reading: "" },
    ];
    const before = structuredClone(f.raw);
    const prepared = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
    assert.equal(prepared.targets.length, 0);
    assert.equal(prepared.output.pronunciations![0].segments.map(s => s.text).join(""), source);
    assert.equal(prepared.output.pronunciations![0].segments[1].reading, undefined);
    assert.ok(prepared.diagnostics.every(d => d.action === "normalized"));
    assert.deepEqual(f.raw, before);
    f.raw.pronunciations[0].segments[0].reading = "";
    assert.equal(
      prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch").targets.length,
      1,
    );
  }
});
test("reading-only repair cannot alter core content or target other annotations", () => {
  const f = fixture("ja", "roman");
  const r = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
  const patch = {
    annotations: [
      {
        path: r.targets[0].path,
        segments: [{ text: f.request.cues[0].originalText, reading: "あれ" }],
      },
    ],
  };
  const fixed = applyPronunciationRepair(
    r.output,
    r.targets.map(t => t.path),
    patch,
  );
  assert.deepEqual(fixed.translations, r.output.translations);
  assert.deepEqual(fixed.reusableItems, r.output.reusableItems);
  assert.equal(prepareTeachingBatch(fixed, f.input, f.request.profile, "batch").targets.length, 0);
  assert.throws(
    () =>
      applyPronunciationRepair(
        r.output,
        r.targets.map(t => t.path),
        { ...patch, translations: [] },
      ),
    /unrecognized_keys/,
  );
  assert.throws(
    () =>
      applyPronunciationRepair(
        r.output,
        r.targets.map(t => t.path),
        { annotations: [] },
      ),
    /coverage/,
  );
  assert.throws(
    () =>
      applyPronunciationRepair(
        r.output,
        r.targets.map(t => t.path),
        {
          annotations: [
            { ...patch.annotations[0], segments: [{ text: "changed", reading: "あ" }] },
          ],
        },
      ),
    /alignment/,
  );
});

test("diagnostics survive documents and markdown; malformed target references are rejected", () => {
  const doc = withReadingDiagnostics(pointsFixture().document);
  assert.deepEqual(
    readLearningDocument(JSON.parse(JSON.stringify(doc))),
    JSON.parse(JSON.stringify(doc)),
  );
  assert.equal(pronunciationMissingCount(doc.execution!.pronunciationDiagnostics), 2);
  assert.match(learningDocumentToMarkdown(doc), /Reading gaps/);
  doc.execution!.pronunciationDiagnostics![0].cueId = "invented";
  assert.throws(() => readLearningDocument(doc), /diagnostic cue/);
});

test("misaligned optional example readings are omitted while exact example text, risks and core validation survive", () => {
  const f = pointsFixture();
  f.request.profile.enabledExplanations!.push("pronunciation");
  const line = f.raw.reusableItems[0].examples[0].dialogue[0];
  line.pronunciation = [{ text: line.text.replaceAll(" ", ""), reading: "/test/" }];
  f.raw.risks = [
    {
      type: "construction_example",
      unitId: "u2",
      path: "/reusableItems/0/examples/0/dialogue/0/pronunciation/0/reading",
      sourceSpans: f.input.scene.utterances[1].sourceSpans,
      description: "Check example reading",
    },
  ];
  const before = structuredClone(f.raw);
  assert.throws(
    () => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
    /alignment/,
  );
  const prepared = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
  assert.equal(prepared.safeOutput.reusableItems[0].examples[0].dialogue[0].text, line.text);
  assert.equal(
    prepared.safeOutput.reusableItems[0].examples[0].dialogue[0].pronunciation,
    undefined,
  );
  assert.equal(prepared.targets.length, 0);
  assert.equal(prepared.diagnostics[0].code, "annotation_alignment");
  assert.equal(prepared.diagnostics[0].action, "omitted");
  assert.equal(prepared.safeOutput.risks[0].path, "/reusableItems/0/examples/0/dialogue/0/text");
  assert.deepEqual(f.raw, before);
  validateTeachingBatch(prepared.safeOutput, f.input, f.request.profile, "batch");
  f.raw.points[0].utteranceIds = ["unassigned"];
  assert.throws(
    () => prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch"),
    /reference/,
  );
});

test("uncertain source readings are omitted for all 14 instruction languages and paired quotation styles", () => {
  const labels: Record<(typeof LEARNING_LANGUAGES)[number], string> = {
    en: "unclear source",
    ja: "原文不明",
    ko: "원문 불명",
    es: "origen incierto",
    fr: "source incertaine",
    de: "Quelle unklar",
    it: "fonte non chiara",
    pt: "fonte incerta",
    id: "sumber tidak jelas",
    th: "ต้นฉบับไม่ชัดเจน",
    ms: "sumber tidak jelas",
    vi: "nguồn gốc không rõ",
    "zh-TW": "原文不明",
    "zh-CN": "原文不明",
  };
  for (const language of LEARNING_LANGUAGES) {
    const label = labels[language];
    const f = pointsFixture();
    f.request.profile.enabledExplanations!.push("pronunciation");
    f.request.profile.instructionLanguage = language;
    const cue = f.request.cues[0];
    f.raw.pronunciations = [
      {
        cueId: cue.id,
        segments: [
          { text: "Why", reading: "/waɪ/" },
          { text: cue.originalText.slice(3), reading: "/test/" },
        ],
      },
    ];
    f.raw.translations[0].text = `«Why» (${label})`;
    const result = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
    assert.equal(result.safeOutput.pronunciations![0].segments[0].reading, undefined, label);
    assert.equal(result.safeOutput.pronunciations![0].segments[1].reading, "/test/");
    assert.equal(f.raw.pronunciations[0].segments[0].reading, "/waɪ/");
  }
});

test("generation drops only empty expression-pattern placeholders without loosening persisted schema or source checks", () => {
  const f = pointsFixture();
  f.raw.reusableItems[1].pattern = "";
  assert.throws(() => validateTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
  const normalized = prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch");
  assert.equal(normalized.safeOutput.reusableItems[1].pattern, undefined);
  assert.equal(f.raw.reusableItems[1].pattern, "");
  assert.equal(normalized.safeOutput.reusableItems[0].pattern, f.raw.reusableItems[0].pattern);
  f.raw.reusableItems[1].pattern = "invented structure";
  assert.throws(() => prepareTeachingBatch(f.raw, f.input, f.request.profile, "batch"));
});
