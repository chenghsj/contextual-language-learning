import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../test/learning-points-fixture";
import { readerPresentation } from "./reader-model";
import { compactStudyExport, learningDocumentToMarkdown } from "./export";

test("shared-source analyses are ordered together after complete source without changing saved content", () => {
  const { document: doc } = pointsFixture();
  const scene = doc.sections[0],
    source = scene.utterances[1],
    cue = doc.cues[1];
  const cut = cue.originalText.indexOf(" when");
  scene.utterances = [
    scene.utterances[0],
    ...[1, 0].map(i => ({
      ...source,
      id: "split-" + i,
      chunks: undefined,
      pointIds: [],
      meaning: i ? "Second clause" : "First clause",
      contextExplanation: "",
      sourceSpans: [{ cueId: cue.id, start: i ? cut : 0, end: i ? cue.originalText.length : cut }],
    })),
  ];
  doc.points = [];
  doc.reusableItems = [];
  const before = JSON.stringify(doc);
  const view = readerPresentation(doc, scene);
  assert.deepEqual(
    view.groups[1].analyses.map(a => a.id),
    ["split-0", "split-1"],
  );
  assert.equal(view.groups[1].anchorCueId, cue.id);
  const markdown = learningDocumentToMarkdown(doc);
  assert.doesNotMatch(markdown, /### Utterance/);
  assert.ok(
    markdown.indexOf("### I was about to head out") < markdown.indexOf("### when you called."),
  );
  assert.equal(markdown.split("> " + cue.originalText).length - 1, 1);
  assert.equal(JSON.stringify(compactStudyExport(doc)), before);
  assert.equal(JSON.stringify(doc), before);
  scene.utterances = [
    {
      ...source,
      chunks: undefined,
      pointIds: [],
      meaning: "Across both cues",
      contextExplanation: "",
      cueIds: scene.cueIds,
      sourceSpans: doc.cues.map(c => ({ cueId: c.id, start: 0, end: c.originalText.length })),
    },
  ];
  const cross = readerPresentation(doc, scene);
  assert.equal(cross.groups.length, 1);
  assert.equal(cross.groups[0].anchorCueId, doc.cues[1].id);
  const exported = learningDocumentToMarkdown(doc);
  assert.ok(
    exported.indexOf("Across both cues") > exported.indexOf("> " + doc.cues[1].originalText),
  );
});

test("empty and repeated explanations disappear before visibility; hidden translation exposes existing meaning", () => {
  const { document: doc } = pointsFixture();
  const scene = doc.sections[0],
    unit = scene.utterances[0];
  const translation = scene.translations.find(t => t.cueId === unit.cueIds[0])!.text;
  unit.meaning = " " + translation + " ";
  unit.contextExplanation = translation;
  assert.equal(readerPresentation(doc, scene).groups[0].analyses.length, 0);
  assert.deepEqual(readerPresentation(doc, scene, false).groups[0].analyses[0].basics, [
    { meaning: translation, contextExplanation: "" },
  ]);
  unit.meaning = "";
  unit.contextExplanation = "";
  assert.equal(readerPresentation(doc, scene, false).groups[0].analyses.length, 0);
  const explained = scene.utterances[1];
  explained.meaning = "Unique explanation";
  explained.contextExplanation = " Unique explanation ";
  doc.points.forEach(p => {
    p.explanation = " Unique explanation ";
    p.presentation = "extended";
  });
  const normalized = readerPresentation(doc, scene).groups[1].analyses[0];
  assert.equal(normalized.notes.length, 0);
  assert.equal(normalized.basics!.length, 1);
  assert.equal(normalized.basics![0].contextExplanation, "");
  // Equal text in a different source remains available, not globally deduplicated.
  unit.meaning = "Unique explanation";
  assert.equal(readerPresentation(doc, scene).analyses.length, 2);
});

test("uncertainty disclosures remain visible in affected fields even when equal to translation", () => {
  const { document: doc } = pointsFixture();
  const scene = doc.sections[0],
    unit = scene.utterances[0];
  const warning = "「悪いない」原文不明，無法確定意思。";
  unit.meaning = warning;
  unit.contextExplanation = warning;
  scene.translations.find(t => t.cueId === unit.cueIds[0])!.text = warning;
  const normalized = readerPresentation(doc, scene).analyses[0];
  assert.equal(normalized.basics![0].meaning, warning);
  assert.equal(normalized.basics![0].contextExplanation, warning);
  assert.ok(learningDocumentToMarkdown(doc).split(warning).length >= 4);
});

test("JSON export retains even unselected source; adjacent title spans do not invent spacing", () => {
  const { document: doc } = pointsFixture();
  doc.cues.push({
    id: "unselected",
    originalText: "Another source cue",
    startMs: 5000,
    endMs: 6000,
  });
  const unit = doc.sections[0].utterances[0],
    cue = doc.cues[0];
  unit.sourceSpans = [
    { cueId: cue.id, start: 0, end: 1 },
    { cueId: cue.id, start: 1, end: cue.originalText.length },
  ];
  assert.equal(readerPresentation(doc, doc.sections[0]).analyses[0].title, cue.originalText);
  assert.deepEqual(compactStudyExport(doc).cues, doc.cues);
  assert.notEqual(compactStudyExport(doc).cues, doc.cues);
  assert.ok(!learningDocumentToMarkdown(doc).includes("Another source cue"));
});
