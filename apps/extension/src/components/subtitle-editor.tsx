import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useContentMotion } from "../hooks/use-content-motion";
import { type SubtitleCue } from "@contextual/core";
import { ArrowLeft, BookOpen, Minus, MoreHorizontal, Plus, Play, Square, X } from "lucide-react";
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
                  <h3 className="text-sm font-semibold">{ux.subtitleText}</h3>
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
                  className="min-h-0 overflow-y-auto overscroll-contain text-sm leading-normal whitespace-pre-wrap wrap-anywhere"
                >
                  {text}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {editControl}
        </div>
      </div>
      <p
        ref={preview}
        className="line-clamp-3 text-sm leading-normal whitespace-pre-wrap wrap-anywhere"
      >
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
  const [actionsOpen, setActionsOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [search, setSearch] = useState(""),
    [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(500);
  const viewport = useRef<HTMLDivElement>(null);
  useContentMotion(viewport, "subtitle-preview", { enter: true, entryOffset: 12, duration: 200 });
  const searchInput = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
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
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const previewRef = useRef<{ adapter: VideoAdapter; url: string } | null>(null);
  async function stopPreview() {
    const active = previewRef.current;
    previewRef.current = null;
    if (mounted.current) setPreviewing(false);
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
    if (!previewing || !adapter?.status || !sourceUrl) return;
    let live = true;
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling || busyRef.current) return;
      polling = true;
      try {
        const state = await adapter.status!(sourceUrl);
        if (live && state.playing === false) await transport(stopPreview);
      } catch {
        if (live)
          await transport(async () => {
            await stopPreview();
            throw new Error("Video status unavailable");
          });
      } finally {
        polling = false;
      }
    }, 300);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [previewing, adapter, sourceUrl, editCopy.unavailable]);
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
      const active = { adapter, url: sourceUrl };
      previewRef.current = active;
      try {
        await adapter.loop!(sourceUrl, { ...previewRange, repeats: 1, delaySeconds: 0 });
        if (mounted.current && previewRef.current === active) setPreviewing(true);
        else {
          await active.adapter.stopLoop?.(active.url);
          await active.adapter.pause?.(active.url);
        }
      } catch (error) {
        await stopPreview();
        throw error;
      }
    });
  }
  function close() {
    if (busyRef.current) return;
    if (previewRef.current) {
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
            className={"text-xs " + (saveStatus === "failed" ? "text-destructive" : "")}
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
                if (restoreRequested.current) {
                  event.preventDefault();
                  restoreRequested.current = false;
                  setRestoreOpen(true);
                }
              }}
            >
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
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = editTrigger.current?.isConnected
              ? editTrigger.current
              : searchInput.current;
            target?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitleBar closeLabel={ux.close} closeDisabled={busy}>
              {ux.edit}
            </DialogTitleBar>
            <DialogDescription className="sr-only">{ux.subtitleText}</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1 text-xs">
            {ux.subtitleText}
            <Textarea
              value={text}
              maxLength={1500}
              onChange={event => setText(event.target.value)}
              disabled={busy}
            />
          </label>
          {editing && editing.startMs !== null && (
            <div className="grid gap-2">
              {(["start", "end"] as const).map(boundary => (
                <div
                  key={boundary}
                  role="group"
                  aria-label={range[boundary]}
                  className="grid gap-1"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <label htmlFor={`${inputId}-${boundary}`}>{range[boundary]}</label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-10 px-2 text-xs whitespace-normal text-right"
                      disabled={
                        busy || !connected || !adapter?.status || !adapter.pause || !sourceUrl
                      }
                      onClick={() => capture(boundary)}
                    >
                      {editCopy.useCurrent}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-10 shrink-0"
                      aria-label={`${range[boundary]} -0.1s`}
                      disabled={busy || !canNudge(boundary, -100)}
                      onClick={() => setTime(boundary, times[boundary].ms - 100)}
                    >
                      <Minus aria-hidden="true" />
                    </Button>
                    <Input
                      id={`${inputId}-${boundary}`}
                      className="h-10 text-center tabular-nums"
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
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-10 shrink-0"
                      aria-label={`${range[boundary]} +0.1s`}
                      disabled={busy || !canNudge(boundary, 100)}
                      onClick={() => setTime(boundary, times[boundary].ms + 100)}
                    >
                      <Plus aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{editCopy.step}</p>
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
              </div>
              <Button
                variant="secondary"
                className="min-h-10"
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
              {!connected && <p className="text-xs text-muted-foreground">{ux.disconnected}</p>}
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
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
        </DialogContent>
      </Dialog>
    </section>
  );
}
