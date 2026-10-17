import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../test/learning-points-fixture";
import { compactStudyExport, learningDocumentToMarkdown } from "./export";
import { readLearningDocument } from "./jobs";
test("current export preserves source and labeled examples, omits empty context", () => {
  const { document } = pointsFixture();
  document.sections[0].utterances[0].contextExplanation = "";
  const markdown = learningDocumentToMarkdown(document);
  assert.match(markdown, /Core explanation/);
  assert.match(markdown, /AI-created/);
  const compact = compactStudyExport(document);
  assert.deepEqual(
    readLearningDocument(JSON.parse(JSON.stringify(compact))),
    JSON.parse(JSON.stringify(compact)),
  );
  assert.equal(document.cues.length, 2);
});
test("retired standard documents are rejected", () =>
  assert.throws(() => readLearningDocument({ schemaVersion: 5 }), /停止支援/));
