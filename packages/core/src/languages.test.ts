import assert from "node:assert/strict";
import test from "node:test";
import {
  CEFR_LANGUAGES,
  EXPLANATION_LANGUAGES,
  LEARNING_LANGUAGES,
  defaultLevelForTargetLanguage,
  levelsForTargetLanguage,
  languageTagMatches,
  UNRESTRICTED_LEVEL,
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

test("twelve languages share CEFR without overwriting Japanese or Korean levels", () => {
  assert.equal(LEARNING_LANGUAGES.length, 14);
  assert.equal(EXPLANATION_LANGUAGES.length, 14);
  assert.equal(new Set(EXPLANATION_LANGUAGES).size, 14);
  for (const language of CEFR_LANGUAGES) {
    assert.deepEqual(levelsForTargetLanguage(language), [
      "A1",
      "A2",
      "B1",
      "B2",
      "C1",
      "C2",
      UNRESTRICTED_LEVEL,
    ]);
  }
  assert.deepEqual(levelsForTargetLanguage("ja"), [
    "N5",
    "N4",
    "N3",
    "N2",
    "N1",
    UNRESTRICTED_LEVEL,
  ]);
  assert.deepEqual(levelsForTargetLanguage("ko"), [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    UNRESTRICTED_LEVEL,
  ]);
  assert.equal(defaultLevelForTargetLanguage("ja"), "N4");
  assert.equal(defaultLevelForTargetLanguage("ko"), "2");
});

test("unrestricted proficiency is a stable saved option for every learning language", () => {
  for (const targetLanguage of LEARNING_LANGUAGES) {
    const profile = LearningProfileSchema.parse({
      targetLanguage,
      instructionLanguage: "zh-TW",
      level: UNRESTRICTED_LEVEL,
      sceneCount: 4,
      contextualExampleCount: 2,
    });
    assert.equal(profile.level, UNRESTRICTED_LEVEL);
    assert.ok(levelsForTargetLanguage(targetLanguage).includes(profile.level));
    assert.notEqual(defaultLevelForTargetLanguage(targetLanguage), UNRESTRICTED_LEVEL);
  }
});

test("Chinese track matching recognizes script aliases without guessing bare zh or mixing scripts", () => {
  for (const tag of ["zh-TW", "zh_Hant", "zh-Hant-TW"])
    assert.equal(languageTagMatches("zh-TW", tag), true, tag);
  for (const tag of ["zh-CN", "zh_Hans", "zh-Hans-CN"])
    assert.equal(languageTagMatches("zh-CN", tag), true, tag);
  for (const language of ["zh-TW", "zh-CN"]) {
    assert.equal(languageTagMatches(language, "zh"), false);
    assert.equal(languageTagMatches(language, "yue-Hant"), false);
  }
  assert.equal(languageTagMatches("zh-TW", "zh-Hans"), false);
  assert.equal(languageTagMatches("zh-CN", "zh-Hant"), false);
  assert.equal(languageTagMatches("en", "en-US"), true);
});
