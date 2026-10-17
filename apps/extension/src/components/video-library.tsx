import { customContentCopy } from "../i18n/custom-content";
import type { CustomContentSummary, CustomDriveSummary } from "@contextual/core";
import React, { useEffect, useMemo, useState } from "react";
import type {
  DriveAccount,
  DriveLessonSummary,
  LessonSummary,
  LearningLanguage,
} from "@contextual/core";
import type { LessonEntry } from "../lib/lesson-catalog";
import {
  mergeLibrary,
  groupLibrary,
  type ContentType,
  type CustomEntry,
  type LibraryEntry,
} from "../lib/library-catalog";
import { readStudyProgress, studyProgressKey, type StudyProgress } from "../lib/study-progress";
import type { MessageKey, MessageParams, UiLocale } from "../i18n/messages";
import { sidePanelLayoutCopy, layoutText } from "../i18n/side-panel-layout";
import { learningLanguageName, LEARNING_LANGUAGE_LABELS } from "../i18n/preferences";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { LibraryErrorNotice } from "./library-error-notice";

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
  catalogErrorAccountId?: string;
  restoreBusy: string | null;
  generating: boolean;
  storageBusy: boolean;
  uiLocale: UiLocale;
  t: (key: MessageKey, params?: MessageParams) => string;
  onRefresh: () => void | Promise<void>;
  onConnectDrive: (accountId?: string) => Promise<void>;
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
  driveAccounts,
  lessonsBusy,
  catalogError,
  catalogErrorAccountId,
  storageBusy,
  restoreBusy,
  generating,
  uiLocale,
  t,
  onRefresh,
  onConnectDrive,
  onOpen,
  onRestore,
}: Props) {
  const customUi = customContentCopy(uiLocale);
  const [contentType, setContentType] = useState<ContentType>("all");
  const ui = sidePanelLayoutCopy[uiLocale];
  const [language, setLanguage] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const busy = lessonsBusy || refreshing;
  async function refresh() {
    if (busy || storageBusy) return;
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
    () => mergeLibrary(localLessons, cloudLessons, localCustom, cloudCustom),
    [localLessons, cloudLessons, localCustom, cloudCustom],
  );
  const languages = [
    ...new Set(
      catalog.flatMap(entry =>
        entry.kind === "standard"
          ? [entry.local?.targetLanguage ?? entry.drive?.targetLanguage].filter(Boolean)
          : [],
      ),
    ),
  ] as string[];
  const groups = useMemo(
    () => groupLibrary(catalog, { language, contentType, search }),
    [catalog, language, contentType, search],
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
  function lessonCard(lesson: LessonEntry, grouped = false) {
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
        data-ui="library-entry"
        className={
          grouped
            ? "grid min-w-0 gap-2 p-3"
            : "grid min-w-0 gap-2 rounded-[var(--radius)] border border-border p-3"
        }
      >
        <h3 className="text-sm font-semibold leading-snug wrap-anywhere">{lesson.title}</h3>
        <p className="text-xs text-muted-foreground">
          {[languageName, content?.level].filter(Boolean).join(" · ")}
        </p>
        {content?.sceneCount !== undefined && (
          <p className="text-xs text-muted-foreground">
            {layoutText(ui.sceneCount, { count: content.sceneCount })}
            {content.pointCount !== undefined &&
              " · " + layoutText(ui.pointCount, { count: content.pointCount })}
            {content.reusableItemCount !== undefined &&
              " · " + layoutText(ui.reusableItemCount, { count: content.reusableItemCount })}
            {content.expressionCount !== undefined &&
              " · " + layoutText(ui.expressionCount, { count: content.expressionCount })}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-muted-foreground">
            {sceneIndex >= 0
              ? `${layoutText(ui.lastScene, { scene: sceneIndex + 1 })} · ${layoutText(ui.studyProgress, { percent })}`
              : lesson.local
                ? ui.notStarted
                : ui.missingContent}
          </p>
          {lesson.local ? (
            <Button
              className="ml-auto"
              variant="ghost"
              size="sm"
              onClick={() => onOpen(lesson.documentId)}
            >
              {sceneIndex >= 0 ? ui.continueStudy : t("openLesson")}
            </Button>
          ) : (
            lesson.drive && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={restoreBusy !== null}
                onClick={() => void onRestore(lesson.drive!)}
              >
                {restoreBusy === lesson.documentId ? t("restoringLesson") : t("restoreLesson")}
              </Button>
            )
          )}
        </div>
        {sceneIndex >= 0 && (
          <Progress value={percent} aria-label={layoutText(ui.studyProgress, { percent })} />
        )}
      </article>
    );
  }
  function customCard(item: CustomEntry, grouped = false) {
    const content = item.local ?? item.drive!;
    const sameTitle =
      content.title.normalize("NFKC").trim() === content.sourceTitle.normalize("NFKC").trim();
    return (
      <article
        key={content.documentId}
        data-ui="library-entry"
        className={
          grouped
            ? "grid min-w-0 gap-2 p-3"
            : "grid min-w-0 gap-2 rounded-[var(--radius)] border border-border p-3"
        }
      >
        <h3 className="text-sm font-semibold leading-snug wrap-anywhere">{content.title}</h3>
        {!grouped && !sameTitle && content.sourceTitle && (
          <p className="text-xs text-muted-foreground wrap-anywhere">{content.sourceTitle}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-muted-foreground">
            {customUi.markdown} · {customUi.unspecified}
          </p>
          {item.local ? (
            <Button
              className="ml-auto"
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
              className="ml-auto"
              disabled={restoreBusy !== null}
              onClick={() => void (item.drive && onRestoreCustom?.(item.drive))}
            >
              {restoreBusy === content.documentId ? t("restoringLesson") : t("restoreLesson")}
            </Button>
          )}
        </div>
      </article>
    );
  }
  function contentCard(entry: LibraryEntry, grouped = false) {
    return entry.kind === "custom" ? customCard(entry, grouped) : lessonCard(entry, grouped);
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
          disabled={busy || storageBusy}
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
      {catalogError && (
        <LibraryErrorNotice
          key={catalogErrorAccountId + ":" + catalogError}
          error={catalogError}
          account={
            catalogErrorAccountId
              ? (driveAccounts.find(account => account.id === catalogErrorAccountId) ?? {
                  id: catalogErrorAccountId,
                })
              : undefined
          }
          locale={uiLocale}
          busy={busy || storageBusy}
          hasLocalContent={localLessons.length > 0 || localCustom.length > 0}
          onRetry={refresh}
          onReconnect={() => onConnectDrive(catalogErrorAccountId)}
        />
      )}
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
        {(
          [
            ["all", customUi.all],
            ["standard", customUi.standard],
            ["custom", customUi.custom],
          ] as const
        ).map(([value, label]) => (
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
      {!lessonsBusy && !catalogError && !groups.length && (
        <p className="text-xs text-muted-foreground">
          {t(
            search.trim() || language !== "all" || contentType !== "all"
              ? "lessonSearchEmpty"
              : "lessonLibraryEmpty",
          )}
        </p>
      )}
      {onCreate && !catalog.length && !localCustom.length && !cloudCustom.length && !busy && (
        <Button onClick={onCreate}>{customUi.createAction}</Button>
      )}
      {groups.map(group =>
        group.entries.length === 1 ? (
          contentCard(group.entries[0])
        ) : (
          <Accordion
            key={`${group.key}:${search.trim() ? "search" : "browse"}`}
            type="single"
            collapsible
            defaultValue={search.trim() ? "content" : undefined}
            data-ui="library-group"
            className="min-w-0 overflow-hidden rounded-[var(--radius)] border border-border"
          >
            <AccordionItem value="content" className="border-b-0">
              <AccordionTrigger
                title={group.title}
                className="gap-3 p-3 transition-colors hover:bg-secondary/50 hover:no-underline"
              >
                <span className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left">
                  <span className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug wrap-anywhere">
                    {group.title}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs font-normal leading-snug text-muted-foreground">
                    {t("lessonGroupCount", { count: group.entries.length })}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <div className="divide-y divide-border border-t border-border">
                  {group.entries.map(entry => contentCard(entry, true))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ),
      )}
    </section>
  );
}
