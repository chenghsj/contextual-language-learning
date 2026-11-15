import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  TimingBoundaryField,
  TimingPositionControl,
  TimingRangeTimeline,
} from "./timing-range-controls";
import { timingControlsCopy } from "../i18n/timing-controls";
import { useContentMotion } from "../hooks/use-content-motion";
import { type SubtitleCue } from "@contextual/core";
import { ArrowLeft, BookOpen, MoreHorizontal, Play, Square, X } from "lucide-react";
import type { UiLocale } from "../i18n/messages";
import { createFlowCopy } from "../i18n/create-flow";
import { analysisRangeCopy } from "../i18n/analysis-range";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogDescription } from "./ui/dialog";
import { DialogTitleBar } from "./dialog-title-bar";
import type { SubtitleDraft } from "../lib/subtitle-draft";
import { formatDisplayTime, parseDisplayTime } from "../lib/time-display";
import { subtitleEditorCopy } from "../i18n/subtitle-editor";
import { subtitleTimingCopy } from "../i18n/subtitle-timing";
import { SubtitleTimingCorrection } from "./subtitle-timing-correction";
import type { VideoAdapter } from "../video/types";
import { isLoopWindow } from "../video/loop-window";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { IconTooltip, restoreFocusWithoutTooltip } from "./icon-tooltip";
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
const ROW_HEIGHT = 108;

function SubtitlePreviewRow({
  text,
  locale,
  timeControl,
  editControl,
}: {
  text: string;
  locale: UiLocale;
  timeControl: React.ReactNode;
  editControl: React.ReactNode;
}) {
  const ux = createFlowCopy(locale);
  const copy = subtitleEditorCopy[locale];
  const preview = useRef<HTMLParagraphElement>(null);
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = preview.current;
    if (!element) return;
    const measure = () => setTruncated(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {timeControl}
        <div className="flex shrink-0 items-center gap-1">
          {truncated && (
            <Popover open={open} onOpenChange={setOpen}>
              <IconTooltip label={copy.readMore}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    aria-label={copy.readMore}
                  >
                    <BookOpen aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
              </IconTooltip>
              <PopoverContent
                align="start"
                collisionPadding={12}
                className="flex max-h-[min(60dvh,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 p-3"
                aria-label={ux.subtitleText}
              >
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <h3 className="text-ui-heading font-semibold">{ux.subtitleText}</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={ux.close}
                    onClick={() => setOpen(false)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <div
                  tabIndex={0}
                  aria-label={ux.subtitleText}
                  className="min-h-0 overflow-y-auto overscroll-contain text-ui-body whitespace-pre-wrap wrap-anywhere"
                >
                  {text}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {editControl}
        </div>
      </div>
      <p ref={preview} className="line-clamp-3 text-ui-body whitespace-pre-wrap wrap-anywhere">
        {text}
      </p>
    </>
  );
}
export function SubtitleEditor({
  draft,
  cues,
  locale,
  duration,
  connected,
  onSeek,
  onBack,
  saveStatus,
  adapter,
  sourceUrl,
  onPlaybackError,
}: {
  draft: SubtitleDraft;
  cues: SubtitleCue[];
  locale: UiLocale;
  duration?: number;
  connected: boolean;
  onSeek: (ms: number) => void;
  onBack: () => void;
  saveStatus: "saving" | "saved" | "failed";
  adapter?: VideoAdapter;
  sourceUrl?: string;
  onPlaybackError?: (message: string) => void;
}) {
  const ux = createFlowCopy(locale),
    range = analysisRangeCopy(locale);
  const editCopy = subtitleEditorCopy[locale];
  const inputId = React.useId();
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const restoreRequested = useRef(false);
  const correctionRequested = useRef(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [search, setSearch] = useState(""),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(500);
  const viewport = useRef<HTMLDivElement>(null);
  useContentMotion(viewport, "subtitle-preview", { enter: true, entryOffset: 12, duration: 280 });
  const searchInput = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const subtitleText = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<SubtitleCue | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const [times, setTimes] = useState({
    start: { text: "", ms: NaN },
    end: { text: "", ms: NaN },
  });
  const [timingMode, setTimingMode] = useState<"preserve" | "manual" | "reset">("preserve");
  const playbackCues = useMemo(
    () => draft.playbackCueMap(),
    [draft, cues, draft.snapshot.originalRaw, draft.snapshot.timingOverrides, sourceUrl],
  );
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [currentMs, setCurrentMs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const previewRef = useRef<{ adapter: VideoAdapter; url: string } | null>(null);
  const inspectionRef = useRef<{ adapter: VideoAdapter; url: string } | null>(null);
  async function stopPreview() {
    const active = previewRef.current ?? inspectionRef.current;
    previewRef.current = null;
    inspectionRef.current = null;
    if (mounted.current) {
      setPreviewing(false);
      setPlaying(false);
    }
    if (active) {
      try {
        await active.adapter.stopLoop?.(active.url);
      } finally {
        await active.adapter.pause?.(active.url);
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void stopPreview().catch(() => onPlaybackError?.(editCopy.unavailable));
    };
  }, [adapter, sourceUrl]);
  useEffect(() => {
    if (!editing || !connected || !adapter?.status || !sourceUrl) return;
    let live = true;
    let polling = false;
    const poll = async () => {
      if (polling || busyRef.current) return;
      polling = true;
      try {
        const state = await adapter.status!(sourceUrl);
        if (!live) return;
        setCurrentMs(
          typeof state.currentMs === "number" && Number.isFinite(state.currentMs)
            ? state.currentMs
            : null,
        );
        setPlaying(state.playing === true);
        if (previewRef.current && state.playing === false) await transport(stopPreview);
      } catch {
        if (live) setCurrentMs(null);
        if (live && previewRef.current)
          await transport(async () => {
            await stopPreview();
            throw new Error("Video status unavailable");
          });
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 300);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [editing?.id, connected, adapter, sourceUrl, editCopy.unavailable]);
  useEffect(() => {
    if (!connected) void stopPreview().catch(() => onPlaybackError?.(editCopy.unavailable));
  }, [connected]);
  const filtered = useMemo(
    () =>
      cues.filter(cue => cue.originalText.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    [cues, search],
  );
  useEffect(() => {
    setScroll(0);
    viewport.current?.scrollTo(0, 0);
  }, [search]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setHeight(entries[0].contentRect.height));
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scroll / ROW_HEIGHT) - 3),
    last = Math.min(filtered.length, Math.ceil((scroll + height) / ROW_HEIGHT) + 3);
  const open = (cue: SubtitleCue) => {
    const effective = playbackCues.get(cue.id) ?? cue;
    setEditing(cue);
    setText(cue.originalText);
    setTimes({
      start: {
        text: effective.startMs === null ? "" : formatDisplayTime(effective.startMs),
        ms: effective.startMs ?? NaN,
      },
      end: {
        text: effective.endMs === null ? "" : formatDisplayTime(effective.endMs),
        ms: effective.endMs ?? NaN,
      },
    });
    setTimingMode("preserve");
    setError("");
  };
  function apply() {
    if (!editing) return true;
    try {
      draft.editCue(
        editing.id,
        {
          originalText: text,
          startMs: editing.startMs === null ? null : times.start.ms,
          endMs: editing.endMs === null ? null : times.end.ms,
        },
        duration,
        timingMode,
      );
      setError("");
      return true;
    } catch {
      setError(editCopy.invalid);
      return false;
    }
  }
  function setTime(boundary: "start" | "end", ms: number) {
    setTimingMode("manual");
    setTimes(current => ({ ...current, [boundary]: { text: formatDisplayTime(ms), ms } }));
    setError("");
  }
  function resetTiming() {
    if (!editing) return;
    const cue = draft.playbackCueMap(editing.id).get(editing.id);
    if (!cue) return;
    setTimes({
      start: {
        text: cue.startMs === null ? "" : formatDisplayTime(cue.startMs),
        ms: cue.startMs ?? NaN,
      },
      end: { text: cue.endMs === null ? "" : formatDisplayTime(cue.endMs), ms: cue.endMs ?? NaN },
    });
    setTimingMode("reset");
    setError("");
  }
  function validTimes(start: number, end: number) {
    return (
      Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start >= 0 &&
      end > start &&
      (duration === undefined || end <= duration)
    );
  }
  function canNudge(boundary: "start" | "end", delta: number) {
    return validTimes(
      times.start.ms + (boundary === "start" ? delta : 0),
      times.end.ms + (boundary === "end" ? delta : 0),
    );
  }
  async function transport(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (mounted.current) setError(editCopy.unavailable);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function capture(boundary: "start" | "end") {
    if (!connected || !adapter?.status || !adapter.pause || !sourceUrl) return;
    void transport(async () => {
      await stopPreview();
      await adapter.pause!(sourceUrl);
      const state = await adapter.status!(sourceUrl);
      if (typeof state.currentMs !== "number" || !Number.isFinite(state.currentMs))
        throw new Error("No position");
      const ms = Math.round(state.currentMs);
      if (mounted.current) {
        setCurrentMs(ms);
        setPlaying(false);
      }
      if (
        !validTimes(
          boundary === "start" ? ms : times.start.ms,
          boundary === "end" ? ms : times.end.ms,
        )
      ) {
        setError(editCopy.invalid);
        return;
      }
      if (mounted.current) setTime(boundary, ms);
    });
  }
  const previewRange = { startMs: times.start.ms, endMs: times.end.ms };
  function preview() {
    if (!connected || !adapter?.loop || !adapter.stopLoop || !adapter.pause || !sourceUrl) return;
    void transport(async () => {
      if (previewRef.current) {
        await stopPreview();
        return;
      }
      if (!validTimes(times.start.ms, times.end.ms)) {
        setError(editCopy.invalid);
        return;
      }
      if (!isLoopWindow(previewRange)) {
        setError(editCopy.previewRange);
        return;
      }
      await stopPreview();
      const active = { adapter, url: sourceUrl };
      previewRef.current = active;
      try {
        await adapter.loop!(sourceUrl, { ...previewRange, repeats: 1, delaySeconds: 0 });
        if (mounted.current && previewRef.current === active) {
          setPreviewing(true);
          setPlaying(true);
          setCurrentMs(times.start.ms);
        } else {
          await active.adapter.stopLoop?.(active.url);
          await active.adapter.pause?.(active.url);
        }
      } catch (error) {
        await stopPreview();
        throw error;
      }
    });
  }
  function seekPosition(value: number) {
    if (!connected || !adapter?.seek || !adapter.pause || !sourceUrl) return;
    void transport(async () => {
      await stopPreview();
      const position = Math.max(0, Math.min(duration ?? 43_200_000, Math.round(value)));
      await adapter.seek!(sourceUrl, position);
      await adapter.pause!(sourceUrl);
      if (mounted.current) {
        setCurrentMs(position);
        setPlaying(false);
      }
    });
  }
  function togglePosition() {
    if (!connected || !adapter?.play || !adapter.pause || !sourceUrl) return;
    void transport(async () => {
      const wasPlaying = playing;
      await stopPreview();
      if (wasPlaying) await adapter.pause!(sourceUrl);
      else {
        inspectionRef.current = { adapter, url: sourceUrl };
        await adapter.play!(sourceUrl);
      }
      if (mounted.current) setPlaying(!wasPlaying);
    });
  }
  function close() {
    if (busyRef.current) return;
    if (previewRef.current || inspectionRef.current) {
      void transport(async () => {
        await stopPreview();
        if (mounted.current) setEditing(null);
      });
    } else setEditing(null);
  }
  return (
    <section
      id="subtitle-preview"
      data-ui="subtitle-editor"
      className="flex min-h-0 flex-1 flex-col gap-3 pb-[max(12px,env(safe-area-inset-bottom))]"
    >
      <header className="flex shrink-0 items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label={editCopy.back}
          className="focus-visible:ring-inset focus-visible:ring-offset-0"
        >
          <ArrowLeft aria-hidden="true" /> {ux.video}
        </Button>
        <div className="flex shrink-0 items-center gap-1">
          <span
            role="status"
            className={saveStatus === "failed" ? "text-ui-body text-destructive" : "text-ui-label"}
          >
            {saveStatus === "saving"
              ? ux.saving
              : saveStatus === "failed"
                ? ux.saveFailed
                : ux.saved}
          </span>
          <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
            <IconTooltip label={editCopy.actions}>
              <PopoverTrigger asChild>
                <Button
                  ref={actionsTrigger}
                  variant="ghost"
                  size="icon"
                  className="size-8 focus-visible:ring-inset focus-visible:ring-offset-0"
                  aria-label={editCopy.actions}
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </PopoverTrigger>
            </IconTooltip>
            <PopoverContent
              align="end"
              collisionPadding={8}
              className="w-auto max-w-[calc(100vw-2rem)] p-1 data-[state=closed]:animate-none"
              aria-label={editCopy.actions}
              onCloseAutoFocus={event => {
                if (correctionRequested.current) {
                  event.preventDefault();
                  correctionRequested.current = false;
                  setCorrectionOpen(true);
                  return;
                }
                if (restoreRequested.current) {
                  event.preventDefault();
                  restoreRequested.current = false;
                  setRestoreOpen(true);
                }
              }}
            >
              {adapter?.id === "youtube" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex h-auto min-h-9 w-full justify-start whitespace-normal text-left"
                  disabled={!draft.snapshot.ready || !cues.some(cue => cue.startMs !== null)}
                  onClick={() => {
                    correctionRequested.current = true;
                    setActionsOpen(false);
                  }}
                >
                  {subtitleTimingCopy[locale].title}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-auto min-h-9 whitespace-normal text-left"
                onClick={() => {
                  restoreRequested.current = true;
                  setActionsOpen(false);
                }}
              >
                {ux.restore}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </header>
      <label className="grid shrink-0 gap-1 text-xs" htmlFor={`${inputId}-search`}>
        {ux.search}
        <Input
          id={`${inputId}-search`}
          ref={searchInput}
          value={search}
          onChange={event => setSearch(event.target.value)}
          className="focus-visible:ring-inset"
        />
      </label>
      <p data-ui="subtitle-count" className="text-xs tabular-nums" aria-live="polite">
        {filtered.length} / {cues.length}
      </p>
      {!connected && <p className="text-xs text-muted-foreground">{ux.disconnected}</p>}
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={event => setScroll(event.currentTarget.scrollTop)}
      >
        <ol className="relative" style={{ height: filtered.length * ROW_HEIGHT }}>
          {filtered.slice(first, last).map((sourceCue, index) => {
            const cue = playbackCues.get(sourceCue.id) ?? sourceCue;
            return (
              <li
                key={cue.id}
                className="absolute inset-x-0 overflow-hidden border-b border-border px-2 py-1.5"
                style={{ top: (first + index) * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <SubtitlePreviewRow
                  text={cue.originalText}
                  locale={locale}
                  timeControl={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 px-2 text-xs tabular-nums text-muted-foreground focus-visible:ring-inset focus-visible:ring-offset-0"
                      disabled={!connected || cue.startMs === null}
                      onClick={() => onSeek(cue.startMs!)}
                    >
                      {cue.startMs === null
                        ? "—"
                        : formatDisplayTime(cue.startMs) + " → " + formatDisplayTime(cue.endMs!)}
                    </Button>
                  }
                  editControl={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={event => {
                        editTrigger.current = event.currentTarget;
                        open(sourceCue);
                      }}
                    >
                      {ux.edit}
                    </Button>
                  }
                />
              </li>
            );
          })}
        </ol>
      </div>
      {correctionOpen && (
        <SubtitleTimingCorrection
          draft={draft}
          locale={locale}
          duration={duration}
          onClose={() => {
            setCorrectionOpen(false);
          }}
          onRestoreFocus={() => restoreFocusWithoutTooltip(actionsTrigger.current)}
        />
      )}
      <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            restoreFocusWithoutTooltip(actionsTrigger.current);
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{ux.restore}</AlertDialogTitle>
            <AlertDialogDescription>{ux.restoreConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ux.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => draft.restoreOriginal()}>
              {ux.restore}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={!!editing}
        onOpenChange={open => {
          if (!open) close();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-1.5rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[480px]"
          data-ui="subtitle-edit-dialog"
          onOpenAutoFocus={event => {
            event.preventDefault();
            subtitleText.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = editTrigger.current?.isConnected
              ? editTrigger.current
              : searchInput.current;
            target?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
            <DialogTitleBar closeLabel={ux.close} closeDisabled={busy}>
              {timingControlsCopy[locale].title}
            </DialogTitleBar>
            <DialogDescription className="text-ui-body sr-only">
              {ux.subtitleText}
            </DialogDescription>
          </DialogHeader>
          <div
            className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-4"
            data-ui="subtitle-edit-body"
          >
            <label className="grid gap-2 text-ui-label font-medium">
              {ux.subtitleText}
              <Textarea
                ref={subtitleText}
                className="min-h-20 resize-y font-normal"
                rows={2}
                value={text}
                maxLength={1500}
                onChange={event => setText(event.target.value)}
                disabled={busy}
              />
            </label>
            {editing && editing.startMs !== null && (
              <div className="grid gap-4 border-t border-border pt-4">
                <TimingPositionControl
                  locale={locale}
                  currentMs={currentMs}
                  playing={playing}
                  seekDisabled={
                    busy ||
                    !connected ||
                    currentMs === null ||
                    !adapter?.seek ||
                    !adapter.pause ||
                    !sourceUrl
                  }
                  toggleDisabled={
                    busy || !connected || !adapter?.play || !adapter.pause || !sourceUrl
                  }
                  onSeek={delta => seekPosition(currentMs! + delta)}
                  onToggle={togglePosition}
                />
                <TimingRangeTimeline
                  locale={locale}
                  labels={{ start: range.start, end: range.end }}
                  startMs={times.start.ms}
                  endMs={times.end.ms}
                  currentMs={currentMs}
                  duration={duration}
                  minDuration={1}
                  maxDuration={43_200_000}
                  disabled={busy}
                  onChange={setTime}
                  onSeek={
                    connected && adapter?.seek && adapter.pause && sourceUrl
                      ? seekPosition
                      : undefined
                  }
                />
                <div className="grid gap-3 border-t border-border pt-3">
                  {(["start", "end"] as const).map(boundary => (
                    <TimingBoundaryField
                      key={boundary}
                      label={range[boundary]}
                      htmlFor={`${inputId}-${boundary}`}
                      captureLabel={editCopy.useCurrent}
                      captureDisabled={
                        busy || !connected || !adapter?.status || !adapter.pause || !sourceUrl
                      }
                      onCapture={() => capture(boundary)}
                      nudgeDisabled={delta => busy || !canNudge(boundary, delta)}
                      onNudge={delta => setTime(boundary, times[boundary].ms + delta)}
                    >
                      <Input
                        id={`${inputId}-${boundary}`}
                        className="h-9 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 text-center font-mono tabular-nums focus-visible:ring-inset"
                        value={times[boundary].text}
                        disabled={busy}
                        spellCheck={false}
                        onChange={event => {
                          const value = event.target.value;
                          setTimingMode("manual");
                          setTimes(current => ({
                            ...current,
                            [boundary]: { text: value, ms: parseDisplayTime(value) },
                          }));
                          setError("");
                        }}
                        onBlur={() => {
                          if (Number.isFinite(times[boundary].ms))
                            setTimes(current => ({
                              ...current,
                              [boundary]: {
                                ...current[boundary],
                                text: formatDisplayTime(current[boundary].ms),
                              },
                            }));
                        }}
                        onKeyDown={event => {
                          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                            event.preventDefault();
                            const delta =
                              (event.key === "ArrowUp" ? 100 : -100) * (event.shiftKey ? 10 : 1);
                            if (canNudge(boundary, delta))
                              setTime(boundary, times[boundary].ms + delta);
                          }
                        }}
                        aria-invalid={error === editCopy.invalid}
                      />
                    </TimingBoundaryField>
                  ))}
                  <p className="text-ui-label leading-relaxed text-muted-foreground">
                    {timingControlsCopy[locale].step}
                  </p>
                </div>
                {!connected && (
                  <p className="text-ui-label text-muted-foreground">{ux.disconnected}</p>
                )}
              </div>
            )}
            {error && (
              <p className="text-ui-body text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer
            className="grid shrink-0 gap-3 border-t border-border bg-card px-4 py-3"
            data-ui="subtitle-edit-footer"
          >
            {editing && editing.startMs !== null && (
              <Button
                variant="secondary"
                className="w-full"
                disabled={
                  busy ||
                  !connected ||
                  !sourceUrl ||
                  !adapter?.loop ||
                  !adapter.stopLoop ||
                  !adapter.pause
                }
                onClick={preview}
              >
                {previewing ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
                {previewing ? editCopy.stop : editCopy.preview}
              </Button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {editing && editing.startMs !== null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    busy ||
                    timingMode === "reset" ||
                    (timingMode === "preserve" && !draft.snapshot.timingOverrides[editing.id])
                  }
                  onClick={resetTiming}
                >
                  {editCopy.reset}
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button variant="outline" disabled={busy} onClick={close}>
                  {ux.cancel}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (apply()) close();
                  }}
                >
                  {ux.done}
                </Button>
              </div>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    </section>
  );
}
