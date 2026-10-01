export type StudyProgress = { sceneId?: string; visitedSceneIds: string[]; updatedAt?: string };
export const studyProgressKey = (documentId: string) => "contextualStudyV5:" + documentId;

/** Read current visit records; a saved position alone never implies a completed visit. */
export function readStudyProgress(saved: unknown, sceneIds: readonly string[]): StudyProgress {
  const value = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const sceneId =
    typeof value.sceneId === "string" && sceneIds.includes(value.sceneId)
      ? value.sceneId
      : undefined;
  const visited = Array.isArray(value.visitedSceneIds) ? value.visitedSceneIds : [];
  return {
    sceneId,
    visitedSceneIds: [
      ...new Set(
        visited.filter((id): id is string => typeof id === "string" && sceneIds.includes(id)),
      ),
    ],
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

export function recordSceneVisit(
  saved: unknown,
  sceneId: string,
  sceneIds: readonly string[],
  now = new Date().toISOString(),
): StudyProgress {
  const prior = readStudyProgress(saved, sceneIds);
  if (!sceneIds.includes(sceneId)) return prior;
  return {
    sceneId,
    visitedSceneIds: [...new Set([...prior.visitedSceneIds, sceneId])],
    updatedAt: now,
  };
}
