import { customContentCopy } from "../i18n/custom-content";
import type { CustomContentSummary, CustomDriveSummary } from "@contextual/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { libraryDeleteCopy } from "../i18n/library-delete";
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
import { Button, destructiveOutlineClassName } from "./ui/button";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { LibraryErrorNotice } from "./library-error-notice";
import { IconTooltip } from "./icon-tooltip";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

type DeleteTarget = { documentId: string; kind: "standard" | "custom"; title: string };
const selectionKey = (item: DeleteTarget) => `${item.kind}:${item.documentId}`;

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
  onDeleteLocal?: (documentId: string, kind: "standard" | "custom") => Promise<void>;
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
  onDeleteLocal,
}: Props) {
  const customUi = customContentCopy(uiLocale);
  const deleteUi = libraryDeleteCopy(uiLocale);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteFailures, setDeleteFailures] = useState<{ title: string; message: string }[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionEntry = useRef<HTMLButtonElement | null>(null);
  const selectAllInput = useRef<HTMLInputElement | null>(null);
  const selectionWasActive = useRef(false);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (selecting) selectAllInput.current?.focus();
    else if (selectionWasActive.current) (selectionEntry.current ?? heading.current)?.focus();
    selectionWasActive.current = selecting;
  }, [selecting]);
  const [contentType, setContentType] = useState<ContentType>("all");
  const ui = sidePanelLayoutCopy[uiLocale];
  const [language, setLanguage] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const busy = lessonsBusy || refreshing;
  const mutationBusy = deleting || storageBusy || restoreBusy !== null;
  function selectionCheckbox(target: DeleteTarget) {
    return (
      <label className="flex h-5 w-4 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          className="size-4 accent-primary dark:[color-scheme:dark]"
          aria-label={`${deleteUi.select} · ${target.title}`}
          checked={selected.has(selectionKey(target))}
          disabled={busy || mutationBusy || generating}
          onChange={event => {
            const checked = event.currentTarget.checked;
            setSelected(current => {
              const next = new Set(current);
              if (checked) next.add(selectionKey(target));
              else next.delete(selectionKey(target));
              return next;
            });
          }}
        />
      </label>
    );
  }
  function cardFrame(
    target: DeleteTarget,
    local: boolean,
    grouped: boolean,
    children: React.ReactNode,
  ) {
    return (
      <article
        key={selectionKey(target)}
        data-ui="library-entry"
        data-selected={(selecting && selected.has(selectionKey(target))) || undefined}
        className={`flex min-w-0 items-start gap-3 p-3 data-[selected=true]:bg-primary/5 ${grouped ? "" : "rounded-[var(--radius)] border border-border"}`}
      >
        {selecting &&
          onDeleteLocal &&
          (local ? (
            selectionCheckbox(target)
          ) : (
            <span aria-hidden="true" className="w-4 shrink-0" />
          ))}
        <div className="grid min-w-0 flex-1 gap-2">{children}</div>
      </article>
    );
  }
  function deleteButton(documentId: string, kind: "standard" | "custom", title: string) {
    if (!onDeleteLocal || selecting) return null;
    const target = { documentId, kind, title };
    return (
      <span className="ml-1 inline-flex shrink-0 items-center gap-2">
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-red-700 dark:hover:text-red-400 [&_svg]:size-3.5"
          aria-label={`${deleteUi.action} · ${title}`}
          disabled={busy || mutationBusy || generating}
          onClick={event => {
            deleteTrigger.current = event.currentTarget;
            setDeleteError("");
            setDeleteFailures([]);
            setDeleteTarget([target]);
          }}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </span>
    );
  }
  async function confirmDelete() {
    if (!deleteTarget || !onDeleteLocal || deletingRef.current || storageBusy) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError("");
    setDeleteFailures([]);
    const failed: DeleteTarget[] = [];
    const reasons: { title: string; message: string }[] = [];
    for (const target of deleteTarget) {
      try {
        await onDeleteLocal(target.documentId, target.kind);
        setSelected(current => {
          const next = new Set(current);
          next.delete(selectionKey(target));
          return next;
        });
      } catch (error) {
        failed.push(target);
        const message = error instanceof Error ? error.message : String(error ?? "");
        reasons.push({
          title: target.title,
          message: /Invalid discriminator value|Unsupported Native Host request/i.test(message)
            ? deleteUi.hostUpdate
            : message.trim().slice(0, 500) || deleteUi.error,
        });
      }
    }
    if (failed.length) {
      setDeleteTarget(failed);
      setDeleteFailures(reasons);
      setDeleteError(
        deleteTarget.length === 1
          ? deleteUi.error
          : layoutText(deleteUi.partialError, {
              deleted: deleteTarget.length - failed.length,
              failed: failed.length,
            }),
      );
    } else {
      setDeleteTarget(null);
    }
    deletingRef.current = false;
    setDeleting(false);
  }
  async function refresh() {
    if (busy || mutationBusy) return;
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
  const selectable = groups.flatMap(group => group.entries).filter(entry => entry.local);
  const selectedEntries = selectable.filter(entry => selected.has(selectionKey(entry)));
  const allSelected = selectable.length > 0 && selectedEntries.length === selectable.length;
  function resetSelection() {
    setSelected(new Set());
  }
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
    return cardFrame(
      { documentId: lesson.documentId, kind: "standard", title: lesson.title },
      Boolean(lesson.local),
      grouped,
      <>
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
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {lesson.local ? (
              <Button
                className="ml-auto"
                variant="ghost"
                size="sm"
                disabled={mutationBusy}
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
                  disabled={mutationBusy}
                  onClick={() => void onRestore(lesson.drive!)}
                >
                  {restoreBusy === lesson.documentId ? t("restoringLesson") : t("restoreLesson")}
                </Button>
              )
            )}
            {lesson.local && deleteButton(lesson.documentId, "standard", lesson.title)}
          </div>
        </div>
        {sceneIndex >= 0 && (
          <Progress value={percent} aria-label={layoutText(ui.studyProgress, { percent })} />
        )}
      </>,
    );
  }
  function customCard(item: CustomEntry, grouped = false) {
    const content = item.local ?? item.drive!;
    const sameTitle =
      content.title.normalize("NFKC").trim() === content.sourceTitle.normalize("NFKC").trim();
    return cardFrame(
      { documentId: content.documentId, kind: "custom", title: content.title },
      Boolean(item.local),
      grouped,
      <>
        <h3 className="text-sm font-semibold leading-snug wrap-anywhere">{content.title}</h3>
        {!grouped && !sameTitle && content.sourceTitle && (
          <p className="text-xs text-muted-foreground wrap-anywhere">{content.sourceTitle}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-muted-foreground">
            {customUi.markdown} · {customUi.unspecified}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {item.local ? (
              <Button
                className="ml-auto"
                size="sm"
                variant="ghost"
                disabled={mutationBusy}
                onClick={() => onOpenCustom?.(content.documentId)}
              >
                {t("openLesson")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={mutationBusy}
                onClick={() => void (item.drive && onRestoreCustom?.(item.drive))}
              >
                {restoreBusy === content.documentId ? t("restoringLesson") : t("restoreLesson")}
              </Button>
            )}
            {item.local && deleteButton(content.documentId, "custom", content.title)}
          </div>
        </div>
      </>,
    );
  }
  function contentCard(entry: LibraryEntry, grouped = false) {
    return entry.kind === "custom" ? customCard(entry, grouped) : lessonCard(entry, grouped);
  }
  return (
    <section className="grid min-w-0 gap-3" aria-labelledby="library-heading">
      <div data-ui="library-header" className="flex min-w-0 items-center justify-between gap-2">
        <h2 ref={heading} tabIndex={-1} id="library-heading" className="text-sm font-semibold">
          {t("lessonLibrary")}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {onDeleteLocal && !selecting && selectable.length > 0 && (
            <IconTooltip label={deleteUi.batchDelete}>
              <Button
                ref={selectionEntry}
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={deleteUi.batchDelete}
                disabled={busy || mutationBusy || generating}
                onClick={() => {
                  setSelecting(true);
                  resetSelection();
                }}
              >
                <ListChecks aria-hidden="true" />
              </Button>
            </IconTooltip>
          )}
          <IconTooltip label={refreshLabel}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={refreshLabel}
              disabled={busy || mutationBusy}
              aria-busy={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw
                aria-hidden="true"
                className={busy ? "animate-spin motion-reduce:animate-none" : undefined}
              />
            </Button>
          </IconTooltip>
        </div>
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
        onChange={event => {
          resetSelection();
          setSearch(event.target.value);
        }}
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
            onClick={() => {
              resetSelection();
              setLanguage(code);
            }}
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
            onClick={() => {
              resetSelection();
              setContentType(value);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {onDeleteLocal && selecting && (
        <div
          data-ui="library-selection"
          role="group"
          aria-label={deleteUi.select}
          className="sticky top-0 z-10 flex min-w-0 items-center justify-between gap-2 border-y border-border bg-background py-2"
        >
          <label className="flex min-h-8 min-w-0 cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              aria-label={deleteUi.selectAll}
              className="size-4 shrink-0 accent-primary dark:[color-scheme:dark]"
              checked={allSelected}
              ref={node => {
                selectAllInput.current = node;
                if (node) node.indeterminate = selectedEntries.length > 0 && !allSelected;
              }}
              disabled={!selectable.length || busy || mutationBusy || generating}
              onChange={event =>
                setSelected(
                  event.currentTarget.checked ? new Set(selectable.map(selectionKey)) : new Set(),
                )
              }
            />
            {deleteUi.allLabel}
          </label>
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={deleteUi.exitSelection}
              disabled={busy || mutationBusy || generating}
              onClick={() => {
                setSelecting(false);
                resetSelection();
              }}
            >
              {deleteUi.cancel}
            </Button>
            {selectedEntries.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className={`${destructiveOutlineClassName} h-auto min-h-8 gap-1.5 whitespace-normal [&_svg]:size-3.5`}
                aria-label={layoutText(deleteUi.deleteSelected, { count: selectedEntries.length })}
                disabled={busy || mutationBusy || generating}
                onClick={event => {
                  deleteTrigger.current = event.currentTarget;
                  setDeleteError("");
                  setDeleteFailures([]);
                  setDeleteTarget(selectedEntries);
                }}
              >
                <Trash2 aria-hidden="true" />
                {layoutText(deleteUi.deleteShort, { count: selectedEntries.length })}
              </Button>
            ) : (
              <span className="px-2 text-xs text-muted-foreground">{deleteUi.selectionEmpty}</span>
            )}
          </div>
        </div>
      )}
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
            key={`${group.key}:${search.trim() ? "search" : "browse"}:${selecting}`}
            type="single"
            collapsible
            defaultValue={search.trim() || selecting ? "content" : undefined}
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
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open && !deletingRef.current) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onEscapeKeyDown={event => {
            if (deletingRef.current) event.preventDefault();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const trigger = deleteTrigger.current;
            (trigger?.isConnected && !trigger.disabled ? trigger : heading.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget && deleteTarget.length > 1
                ? layoutText(deleteUi.batchTitle, { count: deleteTarget.length })
                : deleteUi.title}
            </AlertDialogTitle>
            <ul className="max-h-24 overflow-y-auto space-y-1 text-sm font-medium wrap-anywhere">
              {deleteTarget?.map(item => (
                <li key={selectionKey(item)}>{item.title}</li>
              ))}
            </ul>
            <AlertDialogDescription>{deleteUi.hint}</AlertDialogDescription>
            <p className="text-xs leading-relaxed text-muted-foreground">{deleteUi.kept}</p>
          </AlertDialogHeader>
          {deleteError && (
            <div role="alert" className="grid gap-2 text-sm text-destructive">
              <p>{deleteError}</p>
              <ul className="max-h-32 space-y-2 overflow-y-auto text-xs wrap-anywhere">
                {deleteFailures.map((failure, index) => (
                  <li key={index} className="grid gap-1">
                    <span className="font-medium">{failure.title}</span>
                    <span>{failure.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{deleteUi.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting || storageBusy}
              aria-busy={deleting}
              onClick={event => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting && (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
              {deleting
                ? deleteUi.deleting
                : deleteTarget && deleteTarget.length > 1
                  ? layoutText(deleteUi.deleteSelected, { count: deleteTarget.length })
                  : deleteUi.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
