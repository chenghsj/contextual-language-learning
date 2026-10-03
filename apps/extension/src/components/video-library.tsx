import { customContentCopy } from "../i18n/custom-content";
import type { CustomContentSummary, CustomDriveSummary } from "@immersive/core";
import React, { useEffect, useMemo, useState } from "react";
import type {
  DriveAccount,
  DriveLessonSummary,
  LessonSummary,
  LearningLanguage,
} from "@immersive/core";
import { groupLessons, mergeLessons, type LessonEntry } from "../lib/lesson-catalog";
import { readStudyProgress, studyProgressKey, type StudyProgress } from "../lib/study-progress";
import type { MessageKey, MessageParams, UiLocale } from "../i18n/messages";
import { sidePanelLayoutCopy, layoutText } from "../i18n/side-panel-layout";
import { learningLanguageName, LEARNING_LANGUAGE_LABELS } from "../i18n/preferences";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import { Disclosure } from "./disclosure";
import { Alert, AlertDescription } from "./ui/alert";

type Props = {
  localCustom?: CustomContentSummary[];
  cloudCustom?: CustomDriveSummary[];
  onOpenCustom?: (id: string) => void;
  onRestoreCustom?: (item: CustomDriveSummary) => Promise<void>;
  onCreate?: () => void;
  localLessons: LessonSummary[];
  cloudLessons: DriveLessonSummary[];
  driveAccounts: DriveAccount[];
  driveConfigured: boolean;
  lessonsBusy: boolean;
  catalogError: string;
  restoreBusy: string | null;
  generating: boolean;
  storageBusy: boolean;
  uiLocale: UiLocale;
  t: (key: MessageKey, params?: MessageParams) => string;
  onRefresh: () => void | Promise<void>;
  onConnectDrive: () => Promise<void>;
  onOpen: (id: string) => void;
  onRestore: (lesson: DriveLessonSummary) => Promise<void>;
};

/** The library is about studying; storage and pipeline details belong elsewhere. */
export function VideoLibrary({
  localCustom = [],
  cloudCustom = [],
  onOpenCustom,
  onRestoreCustom,
  onCreate,
  localLessons,
  cloudLessons,
  lessonsBusy,
  catalogError,
  restoreBusy,
  generating,
  uiLocale,
  t,
  onRefresh,
  onOpen,
  onRestore,
}: Props) {
  const customUi = customContentCopy(uiLocale);
  const [contentType, setContentType] = useState("all");
  const ui = sidePanelLayoutCopy[uiLocale];
  const [language, setLanguage] = useState("all");
  const [search, setSearch] = useState("");
  const customCatalog = useMemo(() => {
    const entries = new Map<string, { local?: CustomContentSummary; drive?: CustomDriveSummary }>();
    for (const item of cloudCustom) entries.set(item.documentId, { drive: item });
    for (const item of localCustom)
      entries.set(item.documentId, { ...entries.get(item.documentId), local: item });
    return [...entries.values()]
      .filter(item => {
        const content = item.local ?? item.drive!;
        return (
          (language === "all" || language === "unspecified") &&
          (content.title + " " + content.sourceTitle)
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
        );
      })
      .sort((a, b) =>
        (b.local ?? b.drive!).createdAt.localeCompare((a.local ?? a.drive!).createdAt),
      );
  }, [localCustom, cloudCustom, language, search]);
  const [refreshing, setRefreshing] = useState(false);
  const busy = lessonsBusy || refreshing;
  async function refresh() {
    if (busy) return;
    setRefreshing(true);
    try {
      await Promise.all([onRefresh(), new Promise(resolve => window.setTimeout(resolve, 500))]);
    } finally {
      setRefreshing(false);
    }
  }
  const refreshLabel = busy ? t("refreshingLibrary") : t("refreshLibrary");
  const [progress, setProgress] = useState<Record<string, StudyProgress>>({});
  const catalog = useMemo(
    () => mergeLessons(localLessons, cloudLessons),
    [localLessons, cloudLessons],
  );
  const languages = [
    ...new Set(
      catalog
        .map(lesson => lesson.local?.targetLanguage ?? lesson.drive?.targetLanguage)
        .filter(Boolean),
    ),
  ] as string[];
  const groups = useMemo(
    () =>
      groupLessons(
        catalog.filter(
          lesson =>
            language === "all" ||
            (lesson.local?.targetLanguage ?? lesson.drive?.targetLanguage) === language,
        ),
        "all",
        search,
      ),
    [catalog, language, search],
  );
  useEffect(() => {
    let live = true;
    const load = () =>
      void chrome.storage.local
        .get(localLessons.map(lesson => studyProgressKey(lesson.documentId)))
        .then(saved => {
          if (live)
            setProgress(
              Object.fromEntries(
                localLessons.map(lesson => [
                  lesson.documentId,
                  readStudyProgress(
                    saved[studyProgressKey(lesson.documentId)],
                    lesson.sceneIds ?? [],
                  ),
                ]),
              ),
            );
        })
        .catch(() => {});
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.keys(changes).some(key => key.startsWith("contextualStudy:")))
        load();
    };
    load();
    chrome.storage.onChanged?.addListener(changed);
    return () => {
      live = false;
      chrome.storage.onChanged?.removeListener(changed);
    };
  }, [localLessons]);
  function lessonCard(lesson: LessonEntry) {
    const content = lesson.local ?? lesson.drive;
    const code = content?.targetLanguage;
    const languageName =
      code && code in LEARNING_LANGUAGE_LABELS[uiLocale]
        ? learningLanguageName(code as LearningLanguage, uiLocale)
        : code;
    const studied = progress[lesson.documentId];
    const sceneIndex = lesson.local?.sceneIds?.indexOf(studied?.sceneId ?? "") ?? -1;
    const percent = lesson.local?.sceneCount
      ? Math.round((100 * (studied?.visitedSceneIds.length ?? 0)) / lesson.local.sceneCount)
      : 0;
    return (
      <article
        key={lesson.documentId}
        className="grid gap-2 rounded-[var(--radius)] border border-border p-3"
      >
        <h3 className="text-sm font-semibold leading-snug wrap-anywhere">{lesson.title}</h3>
        <p className="text-xs text-muted-foreground">
          {[languageName, content?.level].filter(Boolean).join(" · ")}
        </p>
        {content?.sceneCount !== undefined && (
          <p className="text-xs text-muted-foreground">
            {layoutText(ui.sceneCount, { count: content.sceneCount })}
            {content.expressionCount !== undefined &&
              " · " + layoutText(ui.expressionCount, { count: content.expressionCount })}
          </p>
        )}
        {sceneIndex >= 0 ? (
          <>
            <p className="text-xs">{layoutText(ui.lastScene, { scene: sceneIndex + 1 })}</p>
            <Progress value={percent} aria-label={layoutText(ui.studyProgress, { percent })} />
            <p className="text-xs text-muted-foreground">
              {layoutText(ui.studyProgress, { percent })}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {lesson.local ? ui.notStarted : ui.missingContent}
          </p>
        )}
        <div className="flex justify-end">
          {lesson.local ? (
            <Button variant="ghost" size="sm" onClick={() => onOpen(lesson.documentId)}>
              {sceneIndex >= 0 ? ui.continueStudy : t("openLesson")}
            </Button>
          ) : (
            lesson.drive && (
              <Button
                variant="outline"
                disabled={restoreBusy !== null}
                onClick={() => void onRestore(lesson.drive!)}
              >
                {restoreBusy === lesson.documentId ? t("restoringLesson") : t("restoreLesson")}
              </Button>
            )
          )}
        </div>
      </article>
    );
  }
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="library-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="library-heading" className="text-sm font-semibold">
          {t("lessonLibrary")}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void refresh()}
        >
          {busy && (
            <span
              aria-hidden="true"
              className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
            />
          )}
          {refreshLabel}
        </Button>
      </div>
      <label className="sr-only" htmlFor="lesson-search">
        {t("lessonSearchLabel")}
      </label>
      <Input
        id="lesson-search"
        type="search"
        value={search}
        onChange={event => setSearch(event.target.value)}
        placeholder={t("lessonSearchPlaceholder")}
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label={ui.filterLanguage}>
        {[
          "all",
          ...languages,
          ...(localCustom.length || cloudCustom.length ? ["unspecified"] : []),
        ].map(code => (
          <Button
            key={code}
            variant={language === code ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={language === code}
            onClick={() => setLanguage(code)}
          >
            {code === "all"
              ? ui.allLanguages
              : code === "unspecified"
                ? customUi.unspecified
                : code in LEARNING_LANGUAGE_LABELS[uiLocale]
                  ? learningLanguageName(code as LearningLanguage, uiLocale)
                  : code}
          </Button>
        ))}
      </div>
      <div role="group" aria-label={customUi.type} className="flex flex-wrap gap-1">
        {[
          ["all", customUi.all],
          ["standard", customUi.standard],
          ["custom", customUi.custom],
        ].map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={contentType === value ? "secondary" : "ghost"}
            aria-pressed={contentType === value}
            onClick={() => setContentType(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {catalogError && (
        <Alert variant="destructive">
          <AlertDescription>{catalogError}</AlertDescription>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>
            {refreshLabel}
          </Button>
        </Alert>
      )}
      {!lessonsBusy &&
        !catalogError &&
        !(contentType !== "custom" && groups.length) &&
        !(contentType !== "standard" && customCatalog.length) && (
          <p className="text-xs text-muted-foreground">
            {t(search.trim() || language !== "all" ? "lessonSearchEmpty" : "lessonLibraryEmpty")}
          </p>
        )}
      {onCreate && !catalog.length && !localCustom.length && !cloudCustom.length && !busy && (
        <Button onClick={onCreate}>{customUi.createAction}</Button>
      )}
      {contentType !== "standard" &&
        customCatalog.map(item => {
          const content = item.local ?? item.drive!;
          return (
            <article
              key={content.documentId}
              className="grid gap-2 rounded-[var(--radius)] border border-border p-3"
            >
              <h3 className="text-sm font-semibold wrap-anywhere">{content.title}</h3>
              <p className="text-xs text-muted-foreground">
                {customUi.markdown} · {customUi.unspecified}
              </p>
              <p className="text-xs text-muted-foreground wrap-anywhere">{content.sourceTitle}</p>
              <div className="flex justify-end">
                {item.local ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenCustom?.(content.documentId)}
                  >
                    {t("openLesson")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoreBusy !== null}
                    onClick={() => void (item.drive && onRestoreCustom?.(item.drive))}
                  >
                    {restoreBusy === content.documentId ? t("restoringLesson") : t("restoreLesson")}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      {contentType !== "custom" &&
        groups.map(group =>
          group.lessons.length === 1 ? (
            lessonCard(group.lessons[0])
          ) : (
            <Disclosure
              key={group.key}
              title={
                <>
                  {group.title} · {t("lessonGroupCount", { count: group.lessons.length })}
                </>
              }
              defaultOpen={!!search.trim()}
            >
              <div className="grid gap-3 pt-2">{group.lessons.map(lessonCard)}</div>
            </Disclosure>
          ),
        )}
    </section>
  );
}
