export const STUDY_STEPS = ["listen", "understand", "practice"] as const;
export type StudyStep = (typeof STUDY_STEPS)[number];

export type SavedSceneProgress = {
  sceneId: string | null;
  completedIds: string[];
  steps: Record<string, StudyStep>;
};

export function isStudyStep(value: unknown): value is StudyStep {
  return typeof value === "string" && STUDY_STEPS.some(step => step === value);
}

/** A step belongs to a scene; switching scenes never advances the other scene. */
export function nextStudyStep(step: StudyStep): StudyStep | null {
  const index = STUDY_STEPS.indexOf(step);
  return STUDY_STEPS[index + 1] ?? null;
}

/** Older saved progress may not include steps. Ignore stale/malformed scene IDs. */
export function readSceneProgress(raw: unknown, sceneIds: readonly string[]): SavedSceneProgress {
  const empty: SavedSceneProgress = { sceneId: null, completedIds: [], steps: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const saved = raw as { sceneId?: unknown; completedIds?: unknown; steps?: unknown };
  const allowed = new Set(sceneIds);
  const sceneId = typeof saved.sceneId === "string" && allowed.has(saved.sceneId)
    ? saved.sceneId : null;
  const completedIds = Array.isArray(saved.completedIds)
    ? [...new Set(saved.completedIds.filter((id): id is string =>
        typeof id === "string" && allowed.has(id)))]
    : [];
  const steps: Record<string, StudyStep> = {};
  if (saved.steps && typeof saved.steps === "object" && !Array.isArray(saved.steps)) {
    for (const [id, step] of Object.entries(saved.steps)) {
      if (allowed.has(id) && isStudyStep(step)) steps[id] = step;
    }
  }
  return { sceneId, completedIds, steps };
}
