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
  type SpeechVoiceCatalog,
  type SystemVoice,
} from "@contextual/core";
import type { SpeechController } from "../native/speech-controller";
import type { UiLocale } from "../i18n/messages";
import {
  speechDownloadCopy,
  speechDownloadError,
  speechVoiceLanguageName,
} from "../i18n/speech-downloads";
import { speechCopy, speechLanguageOptions, speechSamples } from "../i18n/speech";
import { useSystemSpeech } from "./system-speech";
import { IconTooltip, restoreFocusWithoutTooltip } from "./icon-tooltip";
import { SelectField } from "./ui/select";
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
}: {
  locale: UiLocale;
  defaultLanguage: string;
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
    />
  );
}

function SiriVoiceManager({
  controller,
  locale,
  defaultLanguage,
  ready,
  rate,
}: {
  controller: SpeechController;
  locale: UiLocale;
  defaultLanguage: string;
  ready: boolean;
  rate: number;
}) {
  const copy = speechDownloadCopy(locale);
  const speechUi = speechCopy(locale);
  const id = useId();
  const speechState = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [trialVoice, setTrialVoice] = useState<string | null>(null);
  const { catalog, loading, failed, load } = useSiriCatalog(controller, ready);
  const [language, setLanguage] = useState(defaultLanguage);
  const [tab, setTab] = useState("installed");
  const [resourcePaths, setResourcePaths] = useState<Record<string, string>>({});
  const [removal, setRemoval] = useState<SystemVoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<keyof typeof copy | null>(null);
  const [statusVoice, setStatusVoice] = useState<SystemVoice | null>(null);
  const mounted = useRef(true);
  const polling = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      polling.current?.abort();
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
      options.set(language, { value: language, label: speechVoiceLanguageName(language, locale) });
  }
  if (language !== "all" && !options.has(language))
    options.set(language, { value: language, label: speechVoiceLanguageName(language, locale) });
  const changeScope = (next: string, kind: "language" | "tab") => {
    void controller.stop(id).catch(() => {});
    setTrialVoice(null);
    if (kind === "language") setLanguage(next);
    else setTab(next);
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
      if (!mounted.current) return;
      await controller.listVoices(true);
      await load();
      if (mounted.current) {
        setStatus("removed");
      }
    } catch {
      if (mounted.current) setStatus(removed ? "removedRefreshFailed" : "removeFailed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const install = async (voice: SystemVoice) => {
    const voiceId = voice.id;
    const abort = new AbortController();
    polling.current = abort;
    setBusy(true);
    setStatus("requesting");
    setStatusVoice(voice);
    try {
      let result = await controller.installVoice(voiceId);
      if (!abort.signal.aborted && mounted.current) setStatus("requested");
      const deadline = Date.now() + 300_000;
      while (!abort.signal.aborted && result.status !== "installed" && Date.now() < deadline) {
        await new Promise<void>(resolve => {
          const finish = () => {
            clearTimeout(timer);
            abort.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, 2000);
          abort.signal.addEventListener("abort", finish, { once: true });
          if (abort.signal.aborted) finish();
        });
        if (abort.signal.aborted) return;
        result = await controller.voiceInstallation(voiceId);
      }
      if (abort.signal.aborted || !mounted.current) return;
      if (result.status === "installed") {
        await controller.listVoices(true);
        await load();
        if (!abort.signal.aborted && mounted.current) {
          setTab("installed");
          setStatus("installed");
        }
      } else setStatus("timedOut");
    } catch (error) {
      if (!abort.signal.aborted && mounted.current) setStatus(speechDownloadError(error));
    } finally {
      if (polling.current === abort) polling.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const visibleVoices = tab === "installed" ? installed : downloadable;
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
        className="flex min-w-0 items-start gap-2 text-xs leading-5 text-muted-foreground"
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
      <p role="status" className="py-4 text-xs leading-5 text-muted-foreground">
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
            <li key={voice.id} aria-labelledby={nameId} className="min-w-0 px-3 py-4">
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
                  ) : (
                    <IconTooltip label={copy.download}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={copy.download}
                        disabled={busy || !ready || loading}
                        onClick={() => {
                          void install(voice);
                        }}
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
                <p role="alert" className="mt-2 text-xs leading-5 text-destructive">
                  {speechState.errorKind === "voice" ? copy.previewUnavailable : speechUi.failed}
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
          <SelectField
            id={id}
            ariaLabel={copy.language}
            value={language}
            disabled={busy || !ready}
            onValueChange={next => changeScope(next, "language")}
            options={[{ value: "all", label: copy.allLanguages }, ...options.values()]}
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
      {(failed || (catalog && !catalog.available) || !ready) && (
        <p role="alert" className="text-xs leading-5 text-muted-foreground">
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
