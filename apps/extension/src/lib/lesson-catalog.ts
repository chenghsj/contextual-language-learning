import type { DriveLessonSummary, LessonSummary } from "@immersive/core";

export type LessonFilter = "all" | "local" | "drive";
export type LessonEntry = {
  documentId: string; title: string; createdAt: string; sourceKey?: string;
  local?: LessonSummary; drive?: DriveLessonSummary;
};
export type VideoGroup = { key: string; title: string; createdAt: string; lessons: LessonEntry[] };

export function mergeLessons(localLessons: LessonSummary[], cloudLessons: DriveLessonSummary[]): LessonEntry[] {
  const entries = new Map<string, LessonEntry>();
  for (const local of localLessons) entries.set(local.documentId, {
    documentId: local.documentId, title: local.title, createdAt: local.createdAt,
    sourceKey: local.sourceKey, local,
  });
  for (const drive of cloudLessons) {
    const previous = entries.get(drive.documentId);
    entries.set(drive.documentId, previous
      ? { ...previous, sourceKey: previous.sourceKey ?? drive.sourceKey, drive }
      : { documentId: drive.documentId, title: drive.title, createdAt: drive.createdAt,
        sourceKey: drive.sourceKey, drive });
  }
  return [...entries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function groupLessons(entries: LessonEntry[], filter: LessonFilter, search: string): VideoGroup[] {
  const query = search.normalize("NFKC").trim().toLocaleLowerCase();
  const groups = new Map<string, VideoGroup>();
  for (const lesson of entries) {
    if (filter === "local" && !lesson.local || filter === "drive" && !lesson.drive) continue;
    const key = lesson.sourceKey ?? "document:" + lesson.documentId;
    let group = groups.get(key);
    if (!group) {
      group = { key, title: lesson.title, createdAt: lesson.createdAt, lessons: [] };
      groups.set(key, group);
    }
    group.lessons.push(lesson);
    if (lesson.createdAt > group.createdAt) {
      group.title = lesson.title;
      group.createdAt = lesson.createdAt;
    }
  }
  return [...groups.values()]
    .filter(group => !query || group.lessons.some(lesson =>
      lesson.title.normalize("NFKC").toLocaleLowerCase().includes(query)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
