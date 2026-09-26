import assert from "node:assert/strict";
import test from "node:test";
import { GenerationRequestSchema } from "@immersive/core";
import { contextualGenerationProfile, normalizeLessonLength, normalizeSavedLessonProfile } from "./contextual-profile";

const base = {
  targetLanguage: "en" as const, instructionLanguage: "zh-TW" as const, level: "B1",
  sceneCount: 4, mode: "adaptive" as const, exerciseCount: 0, maxNewVocabulary: 8,
  contextualExampleCount: 2,
};

test("lesson length presets cannot conflict with a separate expression budget", () => {
  assert.equal(normalizeLessonLength(1), 2);
  assert.equal(normalizeLessonLength(3), 4);
  assert.equal(normalizeLessonLength(5), 6);
  for (const sceneCount of [2, 4, 6]) {
    const normalized = contextualGenerationProfile({ ...base, sceneCount,
      mode: "immersive", exerciseCount: 6, maxNewVocabulary: 1 });
    assert.equal(normalized.sceneCount, sceneCount);
    assert.equal(normalized.maxNewVocabulary, sceneCount * 2);
    assert.equal(normalized.exerciseCount, 0);
    assert.equal(normalized.mode, "adaptive");
  }
});

test("saved legacy presets adapt to new settings without changing existing document data", () => {
  const oldProfile = { ...base, sceneCount: 5, exerciseCount: 3, maxNewVocabulary: 2,
    mode: "guided" as const };
  const normalized = normalizeSavedLessonProfile(oldProfile, base);
  assert.equal(normalized.sceneCount, 6);
  assert.equal(normalized.maxNewVocabulary, 12);
  assert.equal(normalized.contextualExampleCount, 2);
  assert.equal(oldProfile.sceneCount, 5);
  assert.equal(oldProfile.mode, "guided");
  assert.equal(contextualGenerationProfile({ ...base, contextualExampleCount: 7 }).contextualExampleCount, 2);
});

test("new contextual request remains compatible with the shared schema and older request payloads", () => {
  const newRequest = GenerationRequestSchema.parse({
    id: "11111111-1111-4111-8111-111111111111", lessonFormat: "contextual-v3",
    source: { platform: "import", title: "A video" },
    profile: contextualGenerationProfile(base),
    agent: { provider: "claude", modelId: "" },
    cues: [{ id: "cue-a", startMs: 100, endMs: 300, originalText: "Hello." }],
  });
  assert.equal(newRequest.lessonFormat, "contextual-v3");
  assert.equal(newRequest.profile.contextualExampleCount, 2);
  const oldRequest = GenerationRequestSchema.parse({ ...newRequest,
    lessonFormat: undefined,
    profile: { ...base, contextualExampleCount: undefined, exerciseCount: 1 } });
  assert.equal(oldRequest.lessonFormat, undefined);
  assert.equal(oldRequest.profile.exerciseCount, 1);
});
