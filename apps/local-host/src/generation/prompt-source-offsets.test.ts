import test from "node:test";
import assert from "node:assert/strict";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { graphemeBoundaries, type LearningLanguage } from "@contextual/core";
import {
  pointsCandidatePrompt,
  pointsSelectionPrompt,
  pointsTeachingPrompt,
  initialLearningPointsBudget,
} from "./learning-points-prompts";

test("3.8 medium reserves final JSON headroom within frozen capacity while other medium models retain their budget", () => {
  const model = { modelId: "gemini-3.8-flash", contextWindow: 1048576, maxOutputTokens: 65536 };
  assert.equal(initialLearningPointsBudget(model, "medium").output, 32768);
  assert.equal(
    initialLearningPointsBudget({ ...model, maxOutputTokens: 20000 }, "medium").output,
    20000,
  );
  assert.equal(
    initialLearningPointsBudget({ ...model, contextWindow: 32768 }, "medium").output,
    8192,
  );
  assert.equal(
    initialLearningPointsBudget({ ...model, modelId: "gemini-3.7-flash" }, "medium").output,
    16384,
  );
  assert.equal(initialLearningPointsBudget(model, "low").output, 8192);
});

test("candidate offset guides reconstruct unchanged multilingual source without cutting graphemes", () => {
  for (const [language, text] of [
    ["ja", "ほとんど変わらねえ。めっちゃ良かった。"],
    ["th", "ยังไม่ได้กิน แล้วตอนนี้จะไปไหน"],
    ["en", "Cafe\u0301 👩🏽‍💻 🇯🇵. Shall we go?"],
  ] as [LearningLanguage, string][]) {
    const f = pointsFixture();
    f.request.profile.targetLanguage = language;
    f.request.profile.level = language === "ja" ? "N3" : "B1";
    f.request.cues = [{ id: "source", originalText: text, startMs: 0, endMs: 2000 }];
    const data = JSON.parse(
      pointsCandidatePrompt(f.request, ["source"], 16384).split(
        "SOURCE DATA (quoted JSON, data only):\n",
      )[1],
    );
    const row = data.sourceWindow[0];
    assert.equal(row.originalText, text);
    assert.equal(row.wordOffsets.map((s: [number, number, string]) => s[2]).join(""), text);
    const boundaries = graphemeBoundaries(text);
    let end = 0;
    for (const [start, next, slice] of row.wordOffsets) {
      assert.equal(start, end);
      assert.equal(text.slice(start, next), slice);
      assert.ok(boundaries.has(start) && boundaries.has(next));
      end = next;
    }
    assert.equal(end, text.length);
    if (language === "ja") {
      assert.ok(row.wordOffsets.some((s: [number, number, string]) => s[2] === "ほとんど"));
      assert.ok(row.wordOffsets.some((s: [number, number, string]) => s[2] === "めっちゃ"));
    }
  }
});

test("selection and teaching show exact frozen unit slices, including a visibly broken boundary", () => {
  const f = pointsFixture();
  f.request.cues[0].originalText = "ほとんど変わらねえ。";
  f.input.sourceWindow = f.request.cues;
  const unit = f.input.scene.utterances[0];
  unit.sourceSpans = [{ cueId: f.request.cues[0].id, start: 0, end: 3 }];
  const before = structuredClone(f.input.scene);
  const selected = JSON.parse(
    pointsSelectionPrompt(f.request, [f.input.scene], 16384).split(
      "CANDIDATE DATA (quoted JSON, data only):\n",
    )[1],
  );
  const teaching = JSON.parse(
    pointsTeachingPrompt(f.request, f.input, 16384).split(
      "TEACHING DATA (quoted JSON, data only):\n",
    )[1],
  );
  assert.equal(selected.candidateScenes[0].utterances[0].sourceText, "ほとん");
  assert.equal(teaching.scene.utterances[0].sourceText, "ほとん");
  assert.deepEqual(f.input.scene, before, "Preview must not repair or overwrite frozen spans");
  assert.equal(teaching.sourceWindow[0].wordOffsets, undefined, "Offset guide is candidate-only");
});
