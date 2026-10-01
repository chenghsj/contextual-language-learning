import assert from "node:assert/strict";
import test from "node:test";
import {
  CEFR_LANGUAGES,
  EXPLANATION_LANGUAGES,
  LEARNING_LANGUAGES,
  defaultLevelForTargetLanguage,
  levelsForTargetLanguage,
} from "./languages";
import { LearningProfileSchema } from "./schema";

test("language choices are valid in saved learning profiles independently of interface locale", () => {
  for (const language of LEARNING_LANGUAGES) {
    const profile = LearningProfileSchema.parse({
      targetLanguage: language,
      instructionLanguage: "zh-TW",
      level: defaultLevelForTargetLanguage(language),
      sceneCount: 4,
      contextualExampleCount: 2,
    });
    assert.equal(profile.targetLanguage, language);
    assert.ok(levelsForTargetLanguage(language).includes(profile.level));
  }
  for (const language of EXPLANATION_LANGUAGES) {
    const profile = LearningProfileSchema.parse({
      targetLanguage: "es",
      instructionLanguage: language,
      level: "B1",
      sceneCount: 4,
      contextualExampleCount: 2,
    });
    assert.equal(profile.instructionLanguage, language);
  }
  assert.throws(() =>
    LearningProfileSchema.parse({
      targetLanguage: "xx",
      instructionLanguage: "en",
      level: "B1",
      sceneCount: 4,
      contextualExampleCount: 2,
    }),
  );
});

test("ten languages share CEFR without overwriting Japanese or Korean levels", () => {
  assert.equal(LEARNING_LANGUAGES.length, 12);
  assert.equal(EXPLANATION_LANGUAGES.length, 14);
  for (const language of CEFR_LANGUAGES) {
    assert.deepEqual(levelsForTargetLanguage(language), ["A1", "A2", "B1", "B2", "C1", "C2"]);
  }
  assert.deepEqual(levelsForTargetLanguage("ja"), ["N5", "N4", "N3", "N2", "N1"]);
  assert.deepEqual(levelsForTargetLanguage("ko"), ["1", "2", "3", "4", "5", "6"]);
  assert.equal(defaultLevelForTargetLanguage("ja"), "N4");
  assert.equal(defaultLevelForTargetLanguage("ko"), "2");
});
