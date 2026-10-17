import assert from "node:assert/strict";
import test from "node:test";
import { parseSubtitles } from "@contextual/core";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { pointsCandidatePrompt, pointsTeachingPrompt } from "./learning-points-prompts";

test("candidate and teaching prompts carry separate source readings and clean source text", () => {
  const f = pointsFixture();
  const cues = parseSubtitles(
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<ruby.under>面白<rt>おもしれ</rt></ruby>え～",
  );
  f.request.cues = cues;
  f.request.profile.targetLanguage = "ja";
  f.request.profile.level = "N3";
  f.input.sourceWindow = cues;
  f.input.scene.dialogueCueIds = cues.map(c => c.id);
  f.input.scene.utterances = [
    {
      id: f.input.scene.utterances[0].id,
      cueIds: cues.map(c => c.id),
      sourceSpans: cues.map(c => ({ cueId: c.id, start: 0, end: c.originalText.length })),
    },
  ];
  f.input.requiredUtteranceIds = f.input.scene.utterances.map(u => u.id);
  for (const prompt of [
    pointsCandidatePrompt(f.request, ["cue-1"], 4096),
    pointsTeachingPrompt(f.request, f.input, 4096),
  ]) {
    assert.ok(prompt.includes('"originalText":"面白え～"'));
    assert.ok(
      prompt.includes('"ruby":[{"start":0,"end":2,"reading":"おもしれ","position":"under"}]'),
    );
    assert.ok(!prompt.includes("面白おもしれえ～"));
    assert.match(prompt, /Never append readings to source text/);
  }
});
