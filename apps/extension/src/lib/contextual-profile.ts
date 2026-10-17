import type { LearningProfile } from "@contextual/core";
import { EXPLANATION_TYPES } from "@contextual/core";

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
    contextualExampleCount: 1,
    enabledExplanations: [...EXPLANATION_TYPES],
    emphasizedExplanations: [],
  };
}
