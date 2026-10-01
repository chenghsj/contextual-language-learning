import assert from "node:assert/strict";
import test from "node:test";
import { GenerationRequestSchema } from "@immersive/core";
import { contextualGenerationProfile, normalizeLessonLength, normalizeSavedLessonProfile } from "./contextual-profile";

const base = {
  targetLanguage: "en" as const, instructionLanguage: "zh-TW" as const, level: "B1",
  sceneCount: 4 as const, contextualExampleCount: 2,
};

test("lesson length and contextual example settings have one canonical representation", () => {
  assert.equal(normalizeLessonLength(1), 2);
  assert.equal(normalizeLessonLength(3), 4);
  assert.equal(normalizeLessonLength(5), 6);
  assert.deepEqual(contextualGenerationProfile({ ...base, sceneCount: 6 }), {
    ...base, sceneCount: 6,
  });
  assert.equal(contextualGenerationProfile({ ...base, contextualExampleCount: 7 }).contextualExampleCount, 2);
});

test("old browser preferences retain useful fields without reviving removed generation settings", () => {
  const saved = { ...base, sceneCount: 5, mode: "guided", maxNewVocabulary: 1 };
  const normalized = normalizeSavedLessonProfile(saved, base);
  assert.deepEqual(normalized, { ...base, sceneCount: 6 });
  assert.equal(saved.sceneCount, 5);
});

test("V4 generation requests contain only current profile fields", () => {
  const request = GenerationRequestSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    source: { platform: "import", title: "A video" }, profile: base,
    agent: { provider: "custom-" + "a".repeat(24), modelId: "" },
    cues: [{ id: "cue-a", startMs: 100, endMs: 300, originalText: "Hello." }],
  });
  assert.equal(request.profile.contextualExampleCount, 2);
  assert.equal("lessonFormat" in request, false);
});
