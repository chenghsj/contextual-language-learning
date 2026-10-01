import type { LearningProfile } from "@immersive/core";

export type LessonLength = LearningProfile["sceneCount"];
export function normalizeLessonLength(count: number | undefined): LessonLength {
  return count !== undefined && Number.isFinite(count) && count <= 2
    ? 2
    : count !== undefined && Number.isFinite(count) && count > 4
      ? 6
      : 4;
}

export function contextualGenerationProfile(profile: LearningProfile): LearningProfile {
  return {
    targetLanguage: profile.targetLanguage,
    instructionLanguage: profile.instructionLanguage,
    level: profile.level,
    sceneCount: normalizeLessonLength(profile.sceneCount),
    contextualExampleCount: [1, 2, 3].includes(profile.contextualExampleCount)
      ? profile.contextualExampleCount
      : 2,
  };
}
