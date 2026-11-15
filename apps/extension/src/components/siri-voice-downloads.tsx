import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronRight,
  Download,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import {
  downloadableSpeechVoicesForLanguage,
  normalizeSystemVoices,
  findSystemVoice,
  readAloudVoicesForLanguage,
  speechVoicesForLanguage,
  speechDownloadMatchesVoice,
  isSpeechDownloadActive,
  type SpeechVoiceCatalog,
  type SystemVoice,
} from "@contextual/core";
import { toast } from "sonner";
import type { SpeechController } from "../native/speech-controller";
import type { UiLocale } from "../i18n/messages";
import { speechDownloadCopy, speechVoiceLanguageName } from "../i18n/speech-downloads";
import { speechCopy, speechLanguageOptions, speechSamples } from "../i18n/speech";
import { useSystemSpeech } from "./system-speech";
import { useSpeechDownloads, useSpeechDownloadSnapshot } from "./speech-downloads-provider";
import { speechDownloadTaskCopy } from "../i18n/speech-download-task";
import { SpeechDownloadFeedback } from "./speech-download-feedback";
import { IconTooltip, restoreFocusWithoutTooltip } from "./icon-tooltip";
import { SearchableSelectField } from "./searchable-select-field";
import { LEARNING_LANGUAGE_SEARCH_COPY } from "../i18n/preferences";
import { Button } from "./ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

function useSiriCatalog(controller: SpeechController, ready: boolean) {
  const speech = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [catalog, setCatalog] = useState<SpeechVoiceCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await controller.listVoiceCatalog();
      if (mounted.current && current === generation.current) setCatalog(result);
      return result;
    } catch (error) {
      if (mounted.current && current === generation.current) setFailed(true);
      throw error;
    } finally {
      if (mounted.current && current === generation.current) setLoading(false);
    }
  }, [controller]);
  useEffect(() => {
    if (ready && speech.availability === "ready") void load().catch(() => {});
    else {
      setCatalog(null);
      generation.current++;
      setLoading(false);
    }
  }, [load, ready, speech.voices, speech.availability]);
  return { catalog, loading, failed, load };
}

/** A single entry; downloads and resource actions belong to their own settings page. */
export function SiriVoiceDownloads({
  controller,
  language,
  locale,
  ready,
  onManage,
  restoreManageFocus,
}: {
  controller: SpeechController;
  language: string;
  locale: UiLocale;
  ready: boolean;
  onManage: (language: string) => void;
  restoreManageFocus?: () => void;
}) {
  const { catalog } = useSiriCatalog(controller, ready);
  const copy = speechDownloadCopy(locale);
  const entry = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (catalog?.available && restoreManageFocus) {
      restoreFocusWithoutTooltip(entry.current);
      restoreManageFocus();
    }
  }, [catalog?.available, restoreManageFocus]);
  if (!catalog?.available) return null;
  return (
    <div className="mt-2 border-t border-border py-2">
      <Button
        id="system-speech-manage"
        ref={entry}
        variant="ghost"
        className="h-auto min-h-11 w-full justify-between px-3 py-3 text-left text-xs"
        disabled={!ready}
        onClick={() => {
          void controller.stop().catch(() => {});
          onManage(language);
        }}
      >
        <span>{copy.manage}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function SiriVoiceManagerPage({
  locale,
  defaultLanguage,
  focusVoice,
}: {
  locale: UiLocale;
  defaultLanguage: string;
  focusVoice?: { id: string; tab: "installed" | "downloadable" } | null;
}) {
  const speech = useSystemSpeech();
  if (!speech) return null;
  return (
    <SiriVoiceManager
      controller={speech.controller}
      ready={speech.ready}
      rate={speech.settings.rate}
      locale={locale}
      defaultLanguage={defaultLanguage}
      focusVoice={focusVoice}
    />
  );
}

function SiriVoiceManager({
  controller,
  locale,
  defaultLanguage,
  ready,
  rate,
  focusVoice,
}: {
  controller: SpeechController;
  locale: UiLocale;
  defaultLanguage: string;
  ready: boolean;
  rate: number;
  focusVoice?: { id: string; tab: "installed" | "downloadable" } | null;
}) {
  const copy = speechDownloadCopy(locale);
  const taskCopy = speechDownloadTaskCopy[locale];
  const downloads = useSpeechDownloads();
  const downloadSnapshot = useSpeechDownloadSnapshot();
  const speechUi = speechCopy(locale);
  const id = useId();
  const speechState = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [trialVoice, setTrialVoice] = useState<string | null>(null);
  const { catalog, loading, failed, load } = useSiriCatalog(controller, ready);
  const [language, setLanguage] = useState(defaultLanguage);
  const [tab, setTab] = useState(focusVoice?.tab ?? "installed");
  const [resourcePaths, setResourcePaths] = useState<Record<string, string>>({});
  const [removal, setRemoval] = useState<SystemVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<keyof typeof copy | null>(null);
  const [statusVoice, setStatusVoice] = useState<SystemVoice | null>(null);
  const mounted = useRef(true);
  const completionIds = useRef<Set<string> | null>(null);
  const [startingVoiceIds, setStartingVoiceIds] = useState<Set<string>>(new Set());
  const [downloadErrors, setDownloadErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void controller.stop(id).catch(() => {});
    };
  }, [controller, id]);
  const all = normalizeSystemVoices(catalog?.voices ?? []);
  const scoped = language === "all" ? all : speechVoicesForLanguage(all, language);
  const installed = scoped.filter(
    voice =>
      voice.resourceAvailable === true ||
      (voice.resourceAvailable === undefined && voice.installed === true),
  );
  const resourceVoiceIds = JSON.stringify(installed.map(voice => voice.id));
  useEffect(() => {
    setResourcePaths({});
    if (!ready || tab !== "installed" || resourceVoiceIds === "[]") return;
    let cancelled = false;
    // Resolve the visible list serially rather than spawning a helper for every row at once.
    void (async () => {
      for (const voiceId of JSON.parse(resourceVoiceIds) as string[]) {
        if (cancelled) return;
        try {
          const directory = await controller.voiceFolder(voiceId);
          if (!cancelled) setResourcePaths(paths => ({ ...paths, [voiceId]: directory }));
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [controller, ready, tab, resourceVoiceIds, catalog]);
  const downloadable =
    language === "all"
      ? all.filter(voice => voice.installed === false && voice.resourceAvailable !== true)
      : downloadableSpeechVoicesForLanguage(all, language);
  const options = new Map(speechLanguageOptions(locale).map(option => [option.value, option]));
  for (const language of [defaultLanguage, ...all.map(voice => voice.language)]) {
    const base = language.split("-")[0];
    if (!options.has(language) && !options.has(base))
      options.set(language, {
        value: language,
        label: speechVoiceLanguageName(language, locale),
      });
  }
  if (language !== "all" && !options.has(language))
    options.set(language, {
      value: language,
      label: speechVoiceLanguageName(language, locale),
    });
  const changeScope = (next: string, kind: "language" | "tab") => {
    void controller.stop(id).catch(() => {});
    setTrialVoice(null);
    if (kind === "language") setLanguage(next);
    else setTab(next === "downloadable" ? "downloadable" : "installed");
    setStatus(null);
    setStatusVoice(null);
  };
  const refresh = async () => {
    void controller.stop(id).catch(() => {});
    setTrialVoice(null);
    setBusy(true);
    setStatus(null);
    setStatusVoice(null);
    try {
      void downloads.reconcile().catch(() => setStatus("failed"));
      await controller.listVoices(true);
      await load();
    } catch {
      if (mounted.current) setStatus("failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const openFolder = async (voice: SystemVoice) => {
    setBusy(true);
    setStatus(null);
    setStatusVoice(voice);
    try {
      await controller.openVoiceFolder(voice.id);
    } catch {
      if (mounted.current) setStatus("folderFailed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const remove = async (voice: SystemVoice) => {
    setRemoval(null);
    setBusy(true);
    setStatus("removing");
    setStatusVoice(voice);
    let removed = false;
    try {
      await controller.removeVoice(voice.id);
      removed = true;
      toast.success(voice.name, {
        id: `siri-resource-removal:${voice.id}`,
        description: copy.removed,
      });
      if (!mounted.current) return;
      setStatus(null);
      setStatusVoice(null);
      await controller.listVoices(true);
      await load();
    } catch {
      if (mounted.current) {
        setStatus(removed ? "removedRefreshFailed" : "removeFailed");
        setStatusVoice(voice);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const completedIds = downloadSnapshot.tasks
    .filter(task => task.progress.status === "completed")
    .map(task => task.id)
    .join("|");
  useEffect(() => {
    const current = new Set(completedIds ? completedIds.split("|") : []);
    if (completionIds.current === null) {
      completionIds.current = current;
      return;
    }
    const newlyCompleted = [...current].some(taskId => !completionIds.current?.has(taskId));
    completionIds.current = current;
    if (newlyCompleted && ready) {
      void controller
        .listVoices(true)
        .then(() => load())
        .catch(() => setStatus("failed"));
    }
  }, [completedIds, controller, load, ready]);
  const startDownload = async (voice: SystemVoice) => {
    setStartingVoiceIds(previous => new Set(previous).add(voice.id));
    setDownloadErrors(previous => {
      const next = { ...previous };
      delete next[voice.id];
      return next;
    });
    try {
      await downloads.start(voice.id);
    } catch (error) {
      if (mounted.current)
        setDownloadErrors(previous => ({
          ...previous,
          [voice.id]:
            error instanceof Error && error.message ? error.message : taskCopy.actionFailed,
        }));
    } finally {
      if (mounted.current)
        setStartingVoiceIds(previous => {
          const next = new Set(previous);
          next.delete(voice.id);
          return next;
        });
    }
  };
  const cancelDownload = async (
    voiceId: string,
    taskId: Parameters<typeof downloads.cancel>[0],
  ) => {
    setDownloadErrors(previous => {
      const next = { ...previous };
      delete next[voiceId];
      return next;
    });
    try {
      await downloads.cancel(taskId);
    } catch (error) {
      if (mounted.current)
        setDownloadErrors(previous => ({
          ...previous,
          [voiceId]:
            error instanceof Error && error.message ? error.message : taskCopy.actionFailed,
        }));
    }
  };
  const visibleVoices = tab === "installed" ? installed : downloadable;
  useEffect(() => {
    if (!focusVoice || loading || !catalog) return;
    const row = [...document.querySelectorAll<HTMLElement>("[data-siri-voice-id]")].find(
      item => item.dataset.siriVoiceId === focusVoice.id,
    );
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      row.focus({ preventScroll: true });
    }
  }, [focusVoice, catalog, loading, tab]);
  const statusInRow = statusVoice && visibleVoices.some(voice => voice.id === statusVoice.id);
  const renderStatus = (includeName = false) =>
    status && (
      <p
        role={
          [
            "failed",
            "missingIdentity",
            "rejected",
            "requestTimedOut",
            "folderFailed",
            "removeFailed",
            "removedRefreshFailed",
          ].includes(status)
            ? "alert"
            : "status"
        }
        className="flex min-w-0 items-start gap-2 text-ui-body text-muted-foreground"
      >
        {busy && (
          <LoaderCircle
            className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        <span className="min-w-0 wrap-anywhere">
          {includeName && statusVoice && <span className="font-medium">{statusVoice.name} · </span>}
          <span>{copy[status]}</span>
        </span>
      </p>
    );
  const renderList = (voices: SystemVoice[], resources: boolean) =>
    !voices.length ? (
      <p role="status" className="py-4 text-ui-body text-muted-foreground">
        {resources
          ? language === "all"
            ? copy.noInstalled
            : copy.noInstalledLanguage
          : copy.empty}
      </p>
    ) : (
      <ul
        aria-label={resources ? copy.installedVoice : copy.voice}
        className="grid divide-y divide-border"
      >
        {voices.map(voice => {
          const nameId = id + "-" + encodeURIComponent(voice.id);
          const task = downloadSnapshot.tasks
            .filter(item => speechDownloadMatchesVoice(item, voice))
            .sort(
              (a, b) =>
                Number(isSpeechDownloadActive(b)) - Number(isSpeechDownloadActive(a)) ||
                b.updatedAt.localeCompare(a.updatedAt),
            )[0];
          const taskActive = task && isSpeechDownloadActive(task);
          const sample =
            speechSamples[voice.language] ?? speechSamples[voice.language.split("-")[0]];
          const playable = findSystemVoice(
            readAloudVoicesForLanguage(speechState.voices ?? [], voice.language),
            voice.id,
          );
          const speaking = speechState.active?.scope === id && speechState.active.key === voice.id;
          const canPreview = Boolean(
            sample && playable && voice.installed !== false && speechState.availability === "ready",
          );
          return (
            <li
              key={voice.id}
              aria-labelledby={nameId}
              data-siri-voice-id={voice.id}
              tabIndex={-1}
              className="min-w-0 px-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span id={nameId} className="block text-sm font-medium wrap-anywhere">
                    {voice.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {speechVoiceLanguageName(voice.language, locale)}
                    {!resources && voice.downloadSize
                      ? ` · ${Math.ceil(voice.downloadSize / 1_000_000)} MB`
                      : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {resources ? (
                    <>
                      <IconTooltip
                        label={
                          speaking
                            ? speechUi.stop
                            : canPreview
                              ? speechUi.test
                              : copy.previewUnavailable
                        }
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={speaking ? speechUi.stop : speechUi.test}
                          aria-pressed={speaking}
                          disabled={
                            !speaking &&
                            (busy || !ready || loading || speechState.loading || !canPreview)
                          }
                          onClick={() => {
                            if (speaking) void controller.stop(id).catch(() => {});
                            else {
                              setTrialVoice(voice.id);
                              void controller.speak(
                                voice.id,
                                id,
                                sample ?? "",
                                voice.language,
                                { rate, voices: {} },
                                undefined,
                                voice.id,
                              );
                            }
                          }}
                        >
                          {speaking ? (
                            <Square className="size-4" aria-hidden="true" />
                          ) : (
                            <Volume2 className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      </IconTooltip>
                      <IconTooltip label={copy.openFolder}>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={copy.openFolder}
                          title={resourcePaths[voice.id] || undefined}
                          disabled={busy || !ready || loading}
                          onClick={() => {
                            void openFolder(voice);
                          }}
                        >
                          {busy && statusVoice?.id === voice.id && !status ? (
                            <LoaderCircle
                              className="size-4 animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          ) : (
                            <FolderOpen className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      </IconTooltip>
                      <IconTooltip label={voice.removable ? copy.remove : copy.removeUnavailable}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label={copy.remove}
                          disabled={busy || !ready || loading || !voice.removable}
                          onClick={() => {
                            void controller.stop(id).catch(() => {});
                            setTrialVoice(null);
                            setRemoval(voice);
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </IconTooltip>
                    </>
                  ) : taskActive && task?.progress.status !== "cancelling" ? (
                    <IconTooltip label={taskCopy.cancel}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={taskCopy.cancel}
                        onClick={() => void cancelDownload(voice.id, task.id)}
                      >
                        <Square className="size-4" aria-hidden="true" />
                      </Button>
                    </IconTooltip>
                  ) : taskActive ? null : (
                    <IconTooltip label={copy.download}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={copy.download}
                        disabled={
                          !ready ||
                          loading ||
                          startingVoiceIds.has(voice.id) ||
                          !downloadSnapshot.ready ||
                          downloadSnapshot.service !== "ready"
                        }
                        onClick={() => void startDownload(voice)}
                      >
                        <Download className="size-4" aria-hidden="true" />
                      </Button>
                    </IconTooltip>
                  )}
                </div>
              </div>
              {resources && voice.installed === false && (
                <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">
                  {copy.alreadyDownloaded}
                </p>
              )}
              {trialVoice === voice.id && speechState.error && (
                <p role="alert" className="mt-2 text-ui-body text-destructive">
                  {speechState.errorKind === "voice" ? copy.previewUnavailable : speechUi.failed}
                </p>
              )}
              {!resources && task && task.progress.status !== "completed" && (
                <p
                  role="status"
                  className="mt-2 flex items-start gap-1.5 break-words text-ui-body text-foreground"
                >
                  {taskActive && (
                    <span aria-hidden="true" className="pt-0.5">
                      <SpeechDownloadFeedback
                        task={task}
                        locale={locale}
                        service={downloadSnapshot.service}
                      />
                    </span>
                  )}
                  <span>
                    {task.progress.status === "requesting"
                      ? taskCopy.requesting
                      : task.progress.status === "waiting-system"
                        ? taskCopy.waitingSystem
                        : task.progress.status === "cancelling"
                          ? taskCopy.cancelling
                          : task.progress.status === "cancelled"
                            ? task.progress.shared
                              ? taskCopy.sharedCancelled
                              : taskCopy.cancelled
                            : taskCopy.failed}
                    {task.observation.kind === "unavailable" && ` · ${taskCopy.unavailable}`}
                  </span>
                </p>
              )}
              {downloadErrors[voice.id] && (
                <p role="alert" className="mt-2 break-words text-ui-body text-destructive">
                  {downloadErrors[voice.id]}
                </p>
              )}
              {status && statusVoice?.id === voice.id && (
                <div className="mt-2" data-ui="voice-operation-status">
                  {renderStatus()}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  return (
    <section aria-label={copy.title} className="grid min-w-0 gap-4">
      <div className="flex min-w-0 items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor={id} className="text-xs">
            {copy.language}
          </label>
          <SearchableSelectField
            id={id}
            ariaLabel={copy.language}
            value={language}
            disabled={busy || !ready}
            onValueChange={next => changeScope(next, "language")}
            options={[{ value: "all", label: copy.allLanguages }, ...options.values()]}
            copy={LEARNING_LANGUAGE_SEARCH_COPY[locale]}
          />
        </div>
        <IconTooltip label={copy.refresh}>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label={copy.refresh}
            disabled={busy || !ready || loading}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw
              className={
                busy && !statusVoice ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"
              }
              aria-hidden="true"
            />
          </Button>
        </IconTooltip>
      </div>
      {loading && !catalog && (
        <p role="status" className="text-xs text-muted-foreground">
          {copy.loading}
        </p>
      )}
      {downloadSnapshot.service === "storage-error" && (
        <p role="alert" className="text-ui-body text-destructive">
          {taskCopy.storageError}
        </p>
      )}
      {downloadSnapshot.service === "unavailable" && (
        <p role="alert" className="text-ui-body text-destructive">
          {taskCopy.unavailable}
        </p>
      )}
      {downloadSnapshot.paused && (
        <p role="status" className="text-ui-body">
          {taskCopy.paused}
        </p>
      )}
      {(failed || (catalog && !catalog.available) || !ready) && (
        <p role="alert" className="text-ui-body text-muted-foreground">
          {failed ? copy.failed : copy.unavailable}
        </p>
      )}
      {status && (!statusInRow || failed || !catalog?.available) && (
        <div data-ui="voice-operation-status">{renderStatus(true)}</div>
      )}
      {catalog?.available && !failed && (
        <Tabs value={tab} onValueChange={next => changeScope(next, "tab")}>
          <TabsList className="grid h-auto min-h-9 w-full grid-cols-2">
            <TabsTrigger
              value="installed"
              disabled={busy}
              className="min-w-0 whitespace-normal px-2 text-xs data-[state=active]:font-semibold"
            >
              {copy.downloaded}
            </TabsTrigger>
            <TabsTrigger
              value="downloadable"
              disabled={busy}
              className="min-w-0 whitespace-normal px-2 text-xs data-[state=active]:font-semibold"
            >
              {copy.downloadable}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="installed">{renderList(installed, true)}</TabsContent>
          <TabsContent value="downloadable">{renderList(downloadable, false)}</TabsContent>
        </Tabs>
      )}
      <AlertDialog
        open={!!removal}
        onOpenChange={open => {
          if (!open) setRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {copy.removeTitle} {removal?.name} ·{" "}
            {removal && speechVoiceLanguageName(removal.language, locale)}
          </AlertDialogTitle>
          <AlertDialogDescription>{copy.removeDescription}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removal) void remove(removal);
              }}
            >
              {copy.confirmRemove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
