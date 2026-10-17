import type {
  CustomContentSummary,
  CustomDriveSummary,
  DriveLessonSummary,
  LessonSummary,
} from "@contextual/core";
import { mergeLessons, type LessonEntry } from "./lesson-catalog";

export type CustomEntry = {
  kind: "custom";
  documentId: string;
  title: string;
  sourceTitle: string;
  sourceKey?: string;
  createdAt: string;
  local?: CustomContentSummary;
  drive?: CustomDriveSummary;
};
export type LibraryEntry = (LessonEntry & { kind: "standard" }) | CustomEntry;
export type LibraryGroup = {
  key: string;
  title: string;
  createdAt: string;
  entries: LibraryEntry[];
};
export type ContentType = "all" | "standard" | "custom";

const searchable = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

/** Source identities, rather than titles, join lessons and custom documents. */
export function mergeLibrary(
  localLessons: LessonSummary[],
  cloudLessons: DriveLessonSummary[],
  localCustom: CustomContentSummary[],
  cloudCustom: CustomDriveSummary[],
): LibraryEntry[] {
  const custom = new Map<string, { local?: CustomContentSummary; drive?: CustomDriveSummary }>();
  for (const drive of cloudCustom) custom.set(drive.documentId, { drive });
  for (const local of localCustom)
    custom.set(local.documentId, { ...custom.get(local.documentId), local });
  return [
    ...mergeLessons(localLessons, cloudLessons).map(lesson => ({
      ...lesson,
      kind: "standard" as const,
    })),
    ...[...custom.values()].map(({ local, drive }): CustomEntry => {
      const content = local ?? drive!;
      return {
        kind: "custom",
        documentId: content.documentId,
        title: content.title,
        sourceTitle: content.sourceTitle,
        sourceKey: local?.sourceKey ?? drive?.sourceKey,
        createdAt: content.createdAt,
        local,
        drive,
      };
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function groupLibrary(
  catalog: LibraryEntry[],
  {
    language = "all",
    contentType = "all",
    search = "",
  }: { language?: string; contentType?: ContentType; search?: string } = {},
): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  for (const entry of catalog) {
    const entryLanguage =
      entry.kind === "custom"
        ? "unspecified"
        : (entry.local?.targetLanguage ?? entry.drive?.targetLanguage);
    if (
      (contentType !== "all" && entry.kind !== contentType) ||
      (language !== "all" && entryLanguage !== language)
    )
      continue;
    // Legacy cloud summaries without a source identity stay independent until restored.
    const key = entry.sourceKey
      ? "source:" + entry.sourceKey
      : `document:${entry.kind}:${entry.documentId}`;
    const title = entry.kind === "custom" ? entry.sourceTitle || entry.title : entry.title;
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
      if (entry.createdAt > group.createdAt) {
        group.createdAt = entry.createdAt;
        group.title = title;
      }
    } else groups.set(key, { key, title, createdAt: entry.createdAt, entries: [entry] });
  }
  const query = searchable(search);
  return [...groups.values()]
    .filter(
      group =>
        !query ||
        group.entries.some(entry =>
          searchable(
            entry.title + " " + (entry.kind === "custom" ? entry.sourceTitle : ""),
          ).includes(query),
        ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
