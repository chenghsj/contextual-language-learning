import type { LearningProfile } from "@immersive/core";

/** New lesson length is a user-facing preset, not a second conflicting word budget. */
export type LessonLength = 2 | 4 | 6;
export function normalizeLessonLength(count: number | undefined): LessonLength {
  return count !== undefined && Number.isFinite(count) && count <= 2 ? 2 :
    count !== undefined && Number.isFinite(count) && count > 4 ? 6 : 4;
}

export function contextualGenerationProfile(profile: LearningProfile): LearningProfile {
  const sceneCount = normalizeLessonLength(profile.sceneCount);
  const requested = profile.contextualExampleCount;
  return {
    ...profile, sceneCount,
    mode: "adaptive", exerciseCount: 0,
    maxNewVocabulary: sceneCount * 2,
    contextualExampleCount: requested === 1 || requested === 2 || requested === 3 ? requested : 2,
  };
}

export function normalizeSavedLessonProfile(
  saved: Partial<LearningProfile> | undefined, fallback: LearningProfile,
): LearningProfile {
  return contextualGenerationProfile({ ...fallback, ...saved });
}
