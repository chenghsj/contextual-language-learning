import { cn } from "../lib/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Play, Repeat2, SlidersHorizontal, Square, X } from "lucide-react";
import { formatTime, type LearningDocument, type SubtitleCue } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { contextualReaderMessages, contextualText } from "../i18n/contextual-reader";
import { sceneReaderMessages } from "../i18n/scene-reader";
import { playingCueAt } from "../video/cue-follow";
import {
  adjustLoopBoundary, formatLoopTimestamp, readLoopWindows,
  type LoopBoundary, type LoopWindow,
} from "../video/loop-window";
import { cuePlaybackStart, cuePlaybackWindow, openOrFocusVideoTab } from "../video/tab";
import type { VideoAdapter } from "../video/types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { SelectField } from "./ui/select";

type ContextualDocument = Extract<LearningDocument, { schemaVersion: 3 }>;
type Repeat = "2" | "3" | "5" | "infinite";
type Props = {
  document: ContextualDocument;
  adapter: VideoAdapter;
  locale: UiLocale;
  repeat: Repeat;
  setRepeat: (repeat: Repeat) => void;
  delay: number;
  setDelay: (delay: number) => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  onError: (message: string) => void;
  onDownload: (format: "json" | "md") => void;
};

/** V3 is readable as one cohesive scene. V1/V2 keep their original reader. */
export function ContextualSceneReader({
  document, adapter, locale, repeat, setRepeat, delay, setDelay, playbackRate, setPlaybackRate, onError, onDownload,
}: Props) {
  const copy = contextualReaderMessages[locale];
  const timing = sceneReaderMessages[locale];
  const cues = useMemo(() => new Map(document.cues.map(cue => [cue.id, cue])), [document.cues]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [selectionByScene, setSelectionByScene] = useState<Record<string, string>>({});
  const [translationVisible, setTranslationVisible] = useState(false);
  const [expandedExamples, setExpandedExamples] = useState<Record<string, boolean>>({});
  const [exampleTranslations, setExampleTranslations] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  function markBusy(next: boolean): void { busyRef.current = next; setBusy(next); }
  const [loopingCueId, setLoopingCueId] = useState<string | null>(null);
  const loopingCueRef = useRef<string | null>(null);
  const [loopRanges, setLoopRanges] = useState<Record<string, LoopWindow>>({});
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const calibrationOpenRef = useRef(false);
  const calibrationRef = useRef<HTMLDialogElement>(null);
  const [playbackCueId, setPlaybackCueId] = useState<string | null>(null);
  const [playbackKnown, setPlaybackKnown] = useState(false);
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const scene = document.sections[sceneIndex] ?? document.sections[0];
  const lines = scene.cueIds.map(id => cues.get(id)).filter((cue): cue is SubtitleCue => !!cue);
  const selectedCueId = selectionByScene[scene.id] ?? scene.cueIds[0];
  const selectedCue = cues.get(selectedCueId);
  const selectedIndex = Math.max(0, scene.cueIds.indexOf(selectedCueId));
  const sourceUrl = document.source.url;
  const canLoop = !!sourceUrl && !!adapter.loop;
  const progressKey = "contextualStudy:" + document.id;
  const loopKey = "sceneLoopRanges:" + document.id;
  const selectedRange = selectedCue && selectedCue.startMs !== null &&
    selectedCue.endMs !== null && selectedCue.endMs > selectedCue.startMs
    ? loopRanges[selectedCue.id] ?? cuePlaybackWindow(selectedCue.startMs, selectedCue.endMs) : null;
  const supportsCue = (cue: SubtitleCue | undefined): cue is SubtitleCue =>
    !!cue && cue.startMs !== null && cue.endMs !== null && cue.endMs > cue.startMs;

  useEffect(() => {
    let live = true;
    void chrome.storage.local.get([progressKey, loopKey]).then(saved => {
      if (!live) return;
      const progress = saved[progressKey] as {
        sceneId?: string; selectionByScene?: Record<string, string>;
      } | undefined;
      if (progress?.sceneId) {
        const index = document.sections.findIndex(item => item.id === progress.sceneId);
        if (index >= 0) setSceneIndex(index);
      }
      setLoopRanges(readLoopWindows(saved[loopKey], document.cues.map(cue => cue.id)));
      if (progress?.selectionByScene && typeof progress.selectionByScene === "object") {
        const valid = Object.fromEntries(document.sections.flatMap(item => {
          const id = progress.selectionByScene?.[item.id];
          return id && item.cueIds.includes(id) ? [[item.id, id]] : [];
        }));
        setSelectionByScene(valid);
      }
    }).catch(() => undefined).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [document.id, document.sections, document.cues, progressKey, loopKey]);

  useEffect(() => {
    if (!loaded) return;
    void chrome.storage.local.set({
      [progressKey]: { sceneId: scene.id, selectionByScene },
      [loopKey]: loopRanges,
    }).catch(() => undefined);
  }, [loaded, progressKey, loopKey, loopRanges, scene.id, selectionByScene]);

  useEffect(() => { loopingCueRef.current = loopingCueId; }, [loopingCueId]);
  useEffect(() => { calibrationOpenRef.current = calibrationOpen; }, [calibrationOpen]);
  useEffect(() => {
    const dialog = calibrationRef.current;
    if (!dialog) return;
    if (calibrationOpen && !dialog.open) dialog.showModal();
    if (!calibrationOpen && dialog.open) dialog.close();
  }, [calibrationOpen]);

  /** Native video status—not the last clicked line—drives the highlighted subtitle. */
  useEffect(() => {
    if (!sourceUrl || !adapter.status) {
      setPlaybackKnown(false);
      setPlaybackCueId(null);
      return;
    }
    let live = true;
    let inFlight = false;
    const poll = async () => {
      if (!live || inFlight || busyRef.current) return;
      inFlight = true;
      try {
        const playback = await adapter.status!(sourceUrl);
        if (!live || busyRef.current) return;
        const ms = playback.currentMs;
        if (typeof ms !== "number" || !Number.isFinite(ms)) {
          setPlaybackKnown(false);
          setPlaybackCueId(null);
          return;
        }
        const cueId = playingCueAt(scene.cueIds, cues, ms);
        setPlaybackKnown(true);
        setPlaybackCueId(cueId);
        if (cueId && !loopingCueRef.current && !calibrationOpenRef.current) {
          setSelectionByScene(previous => previous[scene.id] === cueId ? previous
            : { ...previous, [scene.id]: cueId });
        }
      } catch {
        if (live) { setPlaybackKnown(false); setPlaybackCueId(null); }
      } finally { inFlight = false; }
    };
    setPlaybackKnown(false);
    setPlaybackCueId(null);
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 900);
    return () => { live = false; window.clearInterval(timer); };
  }, [sourceUrl, adapter, scene.id, scene.cueIds, cues]);

  async function stopPreviousLoop(): Promise<void> {
    if (!loopingCueRef.current) return;
    if (sourceUrl && adapter.stopLoop) await adapter.stopLoop(sourceUrl);
    loopingCueRef.current = null;
    setLoopingCueId(null);
  }

  async function selectScene(index: number): Promise<void> {
    if (busy || index === sceneIndex || index < 0 || index >= document.sections.length) return;
    markBusy(true);
    try {
      await stopPreviousLoop();
      setSceneIndex(index);
      setTranslationVisible(false);
      setPlaybackCueId(null);
      setPlaybackKnown(false);
      setStatus("");
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  async function playScene(): Promise<void> {
    if (!sourceUrl || !adapter.loop || scene.startMs === null || scene.endMs === null) return;
    markBusy(true);
    try {
      await stopPreviousLoop();
      await adapter.loop(sourceUrl, {
        startMs: cuePlaybackStart(scene.startMs), endMs: scene.endMs + 400,
        repeats: 1, delaySeconds: 0,
      });
      setStatus(copy.playbackStarted);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  async function selectCue(id: string, play = true): Promise<void> {
    if (busy || !scene.cueIds.includes(id)) return;
    const cue = cues.get(id);
    markBusy(true);
    try {
      const resumeLoop = !!loopingCueRef.current;
      await stopPreviousLoop();
      setSelectionByScene(previous => ({ ...previous, [scene.id]: id }));
      if (play && sourceUrl && adapter.loop && supportsCue(cue)) {
        const range = loopRanges[cue.id] ?? cuePlaybackWindow(cue.startMs!, cue.endMs!);
        await adapter.loop(sourceUrl, {
          ...range,
          repeats: resumeLoop ? repeat === "infinite" ? "infinite" : Number(repeat) : 1,
          delaySeconds: resumeLoop ? delay : 0,
        });
        if (resumeLoop) { loopingCueRef.current = cue.id; setLoopingCueId(cue.id); }
        setStatus(resumeLoop ? copy.loopStarted : copy.playbackStarted);
      } else if (play && !supportsCue(cue)) {
        setStatus(copy.noTime);
      } else {
        setStatus("");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  async function toggleLoop(): Promise<void> {
    if (!sourceUrl || !adapter.loop || !supportsCue(selectedCue) || busy) return;
    markBusy(true);
    try {
      if (loopingCueId === selectedCue.id) {
        await stopPreviousLoop();
        setStatus(copy.loopStopped);
      } else {
        await stopPreviousLoop();
        await adapter.loop(sourceUrl, {
          ...(loopRanges[selectedCue.id] ?? cuePlaybackWindow(selectedCue.startMs!, selectedCue.endMs!)),
          repeats: repeat === "infinite" ? "infinite" : Number(repeat),
          delaySeconds: delay,
        });
        loopingCueRef.current = selectedCue.id;
        setLoopingCueId(selectedCue.id);
        setStatus(copy.loopStarted);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  /** A/B edits use real video time and invalidate the old loop before saving a new window. */
  async function updateRange(boundary: LoopBoundary | "reset", position: number | "current" = 0): Promise<void> {
    if (busyRef.current || !selectedCue || !selectedRange) return;
    markBusy(true);
    try {
      let next: LoopWindow | null = null;
      if (boundary !== "reset") {
        let target = position;
        if (target === "current") {
          if (!sourceUrl || !adapter.status) { setStatus(timing.positionUnavailable); return; }
          const playback = await adapter.status(sourceUrl);
          if (typeof playback.currentMs !== "number" || !Number.isFinite(playback.currentMs)) {
            setStatus(timing.positionUnavailable);
            return;
          }
          target = playback.currentMs;
        }
        next = adjustLoopBoundary(selectedRange, boundary, target as number);
        if (!next) { setStatus(timing.invalidLoopRange); return; }
      }
      await stopPreviousLoop();
      const id = selectedCue.id;
      setLoopRanges(previous => {
        const updated = { ...previous };
        if (next) updated[id] = next;
        else delete updated[id];
        return updated;
      });
      setStatus(next ? timing.loopRangeSaved : timing.loopRangeReset);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally { markBusy(false); }
  }

  async function changeRate(rate: number): Promise<void> {
    if (!sourceUrl || !adapter.setPlaybackRate || busy) return;
    markBusy(true);
    try {
      await adapter.setPlaybackRate(sourceUrl, rate);
      setPlaybackRate(rate);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  async function openVideo(): Promise<void> {
    if (!sourceUrl || busy) return;
    markBusy(true);
    try {
      await openOrFocusVideoTab(adapter, sourceUrl);
      setStatus(copy.videoOpened);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  return <div className="min-w-0">
    <Card className="p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1 [&>strong]:block [&>strong]:text-[13px] [&>strong]:wrap-anywhere [&_[data-ui=hint]]:my-[3px]">
          <strong>{document.source.title}</strong>
          <span className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</span>
        </div>
        <div className="flex gap-[5px]">
          <Button size="sm" variant="outline" onClick={() => onDownload("json")}>JSON</Button>
          <Button size="sm" variant="outline" onClick={() => onDownload("md")}>MD</Button>
        </div>
      </div>
      <div className="mt-[10px] grid grid-cols-[36px_minmax(0,1fr)_36px] items-end gap-[7px] [&>div]:grid [&>div]:min-w-0 [&>div]:gap-1 [&>button]:size-9 [&_[data-slot=select-trigger]]:w-full">
        <Button variant="outline" size="icon" aria-label={copy.previousScene}
          disabled={busy || sceneIndex === 0} onClick={() => void selectScene(sceneIndex - 1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <div>
          <span className="text-[11px] text-muted-foreground tabular-nums">{copy.scene} {sceneIndex + 1} / {document.sections.length}</span>
          <SelectField id="contextual-scene-picker" ariaLabel={copy.chooseScene}
            value={String(sceneIndex)} disabled={busy} onValueChange={value => void selectScene(Number(value))}
            options={document.sections.map((item, index) => ({
              value: String(index), label: (index + 1) + ". " + item.title +
                " (" + formatTime(item.startMs) + "–" + formatTime(item.endMs) + ")",
            }))} />
        </div>
        <Button variant="outline" size="icon" aria-label={copy.nextScene}
          disabled={busy || sceneIndex === document.sections.length - 1}
          onClick={() => void selectScene(sceneIndex + 1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </Card>

    <Card className="min-w-0 px-3 py-[14px] [&_h2]:mt-[5px] [&_h2]:mb-0 [&_h2]:text-[17px] [&_h3]:m-0 [&_h3]:text-sm [&_h3]:normal-case [&_h3]:tracking-normal [&_h3]:text-foreground">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div>
          <span className="text-[11px] text-muted-foreground tabular-nums">{formatTime(scene.startMs)}–{formatTime(scene.endMs)}</span>
          <h2>{scene.title}</h2>
        </div>
        {sourceUrl && adapter.id !== "import" && <Button size="icon" variant="ghost"
          aria-label={copy.video} disabled={busy} onClick={() => void openVideo()}>
          <ExternalLink aria-hidden="true" />
        </Button>}
      </div>
      <p className="my-[8px_12px] text-[13px] leading-[1.6] text-muted-foreground">{scene.context}</p>
      <Button variant="outline" className="min-h-[38px] w-full" disabled={busy || !canLoop ||
        scene.startMs === null || scene.endMs === null} onClick={() => void playScene()}>
        <Play aria-hidden="true" />{copy.playScene}
      </Button>
      {!canLoop && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{copy.noVideo}</p>}

      <div className="flex min-w-0 items-center justify-between gap-2 mt-[18px] [&>button]:shrink-0 [&+.hint]:mt-1 [&+.hint]:mb-[10px] [&+.hint]:text-[11px]">
        <h3>{copy.dialogue}</h3>
        <Button size="sm" variant="ghost" onClick={() => setTranslationVisible(value => !value)}>
          {translationVisible ? copy.hideTranslation : copy.translation}
          <ChevronDown aria-hidden="true" />
        </Button>
      </div>
      <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{copy.subtitleNotice}</p>
      <div className="overflow-hidden rounded-[var(--radius)] border border-border" role="group" aria-label={copy.dialogue}>
        {lines.map((cue, index) => {
          const focused = scene.focusItems.some(item => item.sourceCueIds.includes(cue.id));
          const selected = selectedCueId === cue.id;
          const playing = playbackKnown && playbackCueId === cue.id;
          const translation = scene.translations.find(row => row.cueId === cue.id);
          return <button key={cue.id} type="button"
            className={cn("cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 grid h-auto w-full min-w-0 grid-cols-[24px_minmax(0,1fr)_auto_16px] items-start gap-[7px] rounded-none border-0 bg-card px-[9px] py-[11px] text-left text-[13px] leading-[1.65] text-foreground not-first:border-t not-first:border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] max-[355px]:grid-cols-[20px_minmax(0,1fr)_12px]",
              selected && !playing && "shadow-[inset_2px_0_var(--border)]",
              playing && "bg-[color-mix(in_oklch,var(--primary)_11%,var(--card))]! shadow-[inset_3px_0_var(--primary)]!",
              !playbackKnown && selected && "bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))]! shadow-[inset_3px_0_var(--primary)]!")}
            aria-current={playing ? "true" : undefined}
            aria-pressed={selected} disabled={busy} onClick={() => void selectCue(cue.id)}>
            <span className="text-[11px] text-muted-foreground tabular-nums">{String(index + 1).padStart(2, "0")}</span>
            <span className="grid min-w-0 gap-[5px] wrap-anywhere">
              <span lang={document.profile.targetLanguage}>{cue.originalText}</span>
              {translationVisible && translation && <span className="block text-xs leading-[1.55] text-muted-foreground">{translation.text}</span>}
            </span>
            {focused && <span className="whitespace-nowrap rounded-[var(--radius)] border border-border px-[3px] py-px text-[10px] text-muted-foreground max-[355px]:col-start-2 max-[355px]:w-fit">{copy.focus}</span>}
            <Play aria-hidden="true" className="size-[14px] text-muted-foreground max-[355px]:col-start-3 max-[355px]:row-start-1 max-[355px]:size-3" />
          </button>;
        })}
      </div>

      <div className="mt-5 grid gap-[22px]">
        {scene.focusItems.map((focus, focusIndex) => {
          const key = scene.id + ":" + focusIndex;
          const more = expandedExamples[key] ?? false;
          const visibleExamples = more ? focus.examples : focus.examples.slice(0, 1);
          return <section className="min-w-0 border-t border-border pt-4 [&>h3]:text-lg [&>h3]:wrap-anywhere" key={key}>
            <span className="mb-[7px] block text-[11px] font-[650] text-muted-foreground">{copy.focus} {focusIndex + 1} / {scene.focusItems.length}</span>
            <h3 lang={document.profile.targetLanguage}>{focus.expression}</h3>
            <p className="mt-[5px] mb-[14px] text-[13px]">{focus.meaning}</p>
            <div className="rounded-[var(--radius)] bg-muted px-3 py-[10px] text-xs leading-[1.65] [&>p]:mt-[5px] [&>p]:mb-0">
              <strong>{copy.context}</strong>
              <p>{focus.contextExplanation}</p>
            </div>
            {focus.wordNotes.length > 0 && <details className="[&_p]:text-muted-foreground my-2 rounded-[var(--radius)] border border-border p-[10px] text-[13px] [&_p]:mb-[2px] my-[11px] px-3 py-[10px] [&>summary]:text-xs">
              <summary className="cursor-pointer font-semibold">{copy.words}</summary>
              {focus.wordNotes.map((word, index) =>
                <div className="pt-[11px] text-xs [&:not(:first-of-type)]:mt-[10px] [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:border-border [&>strong]:mr-2 [&>span]:text-muted-foreground [&>p]:mt-[5px] [&>p]:mb-0" key={index}>
                  <strong lang={document.profile.targetLanguage}>{word.surface}</strong>
                  <span>{word.meaning}</span>
                  <p>{word.explanation}</p>
                </div>)}
            </details>}
            <div className="mt-4 min-w-0 [&_[data-ui=hint]]:mt-1 [&_[data-ui=hint]]:mb-[10px]">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <h4>{copy.examples}</h4>
                <span className="text-[11px] text-muted-foreground tabular-nums">{focus.examples.length}</span>
              </div>
              <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{copy.aiExamples}</p>
              {visibleExamples.map((example, exampleIndex) => {
                const exampleKey = key + ":" + exampleIndex;
                const show = exampleTranslations[exampleKey] ?? false;
                return <div className="border-t border-border py-[10px]" key={exampleKey}>
                  <p className="mb-2 text-[11px] leading-[1.6] text-muted-foreground">{example.situation}</p>
                  {example.dialogue.map((line, index) =>
                    <div key={index} className="mb-[7px] [&>p]:m-0 [&>p]:text-[13px] [&>p]:leading-[1.5] [&>p]:wrap-anywhere [&>p:not([lang])]:mt-[2px] [&>p:not([lang])]:text-xs">
                      <p lang={document.profile.targetLanguage}>{line.text}</p>
                      {show && <p className="block text-xs leading-[1.55] text-muted-foreground">{line.translation}</p>}
                    </div>)}
                  <Button size="sm" variant="ghost" onClick={() => setExampleTranslations(previous => ({
                    ...previous, [exampleKey]: !show,
                  }))}>{show ? copy.hideTranslation : copy.translation}</Button>
                </div>;
              })}
              {focus.examples.length > 1 && <Button size="sm" variant="ghost"
                className="mt-[3px] w-full"
                onClick={() => setExpandedExamples(previous => ({ ...previous, [key]: !more }))}>
                {more ? copy.hideExamples : contextualText(copy.anotherExamples, {
                  count: focus.examples.length - 1,
                })}
                <ChevronDown aria-hidden="true" />
              </Button>}
            </div>
          </section>;
        })}
      </div>
    </Card>

    {sourceUrl && adapter.id !== "import" && adapter.loop && <div className="sticky bottom-0 z-[5] min-w-0 border-t border-border bg-card px-3 py-[9px] shadow-[0_-6px_18px_#00000012]"
      role="region" aria-label={copy.playback}>
      <div className="grid min-w-0 gap-[3px] [&>strong]:block [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-xs [&>strong]:leading-[1.4]">
        <span className="text-[11px] text-muted-foreground tabular-nums">{copy.selected} · {selectedIndex + 1} / {scene.cueIds.length}</span>
        <strong lang={document.profile.targetLanguage} title={selectedCue?.originalText}>
          {selectedCue?.originalText}
        </strong>
      </div>
      <div className="mt-2 grid grid-cols-[36px_minmax(0,1fr)_36px_74px] items-center gap-[5px] [&>button]:w-full [&>button]:min-w-0 [&>[data-slot=select-trigger]]:w-full [&>[data-slot=select-trigger]]:min-w-0 [&>[data-slot=select-trigger]]:px-[6px] [&>[data-slot=select-trigger]]:text-xs max-[355px]:grid-cols-[32px_minmax(0,1fr)_32px_60px] max-[355px]:gap-1 max-[355px]:[&>[data-slot=select-trigger]]:px-[3px]">
        <Button size="icon" variant="outline" aria-label={copy.previousCue}
          disabled={busy || selectedIndex === 0} onClick={() => void selectCue(scene.cueIds[selectedIndex - 1])}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button className="h-auto min-h-9 whitespace-normal p-[6px]" size="sm"
          variant={loopingCueId === selectedCueId ? "secondary" : "default"}
          disabled={busy || !supportsCue(selectedCue)}
          aria-pressed={loopingCueId === selectedCueId} onClick={() => void toggleLoop()}>
          {loopingCueId === selectedCueId ? <Square aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}
          {loopingCueId === selectedCueId ? copy.stopLoop : copy.loopCue}
        </Button>
        <Button size="icon" variant="outline" aria-label={copy.nextCue}
          disabled={busy || selectedIndex === scene.cueIds.length - 1}
          onClick={() => void selectCue(scene.cueIds[selectedIndex + 1])}>
          <ChevronRight aria-hidden="true" />
        </Button>
        {adapter.setPlaybackRate && <SelectField ariaLabel={copy.speed} value={String(playbackRate)}
          disabled={busy} onValueChange={value => void changeRate(Number(value))}
          options={[0.5, 0.75, 1, 1.25, 1.5].map(rate => ({
            value: String(rate), label: rate + "×",
          }))} />}
      </div>
      <Button size="sm" variant="ghost" className="mt-[3px] flex min-h-[30px] w-full justify-center text-[11px] text-muted-foreground"
        aria-expanded={calibrationOpen} disabled={busy || !selectedRange}
        onClick={() => setCalibrationOpen(true)}>
        <SlidersHorizontal aria-hidden="true" />{copy.adjustPosition}
      </Button>
      <dialog className="max-h-[min(560px,84vh)] w-[min(370px,calc(100vw-22px))] max-w-[calc(100vw-22px)] overflow-auto rounded-[var(--radius)] border border-border bg-card p-4 text-foreground shadow-[0_20px_60px_#0004] backdrop:bg-[#0008]" ref={calibrationRef}
        aria-labelledby="contextual-time-dialog-title"
        onClose={() => setCalibrationOpen(false)}
        onCancel={() => setCalibrationOpen(false)}>
        <div className="flex items-center justify-between gap-[10px] [&>h3]:m-0 [&>h3]:text-base [&>button]:shrink-0">
          <h3 id="contextual-time-dialog-title">{copy.adjustPosition}</h3>
          <Button size="icon" variant="ghost" aria-label={copy.close}
            onClick={() => setCalibrationOpen(false)}><X aria-hidden="true" /></Button>
        </div>
        <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{timing.loopRangeHint}</p>
        <div className="my-[14px] grid grid-cols-2 gap-[10px] [&>div]:min-w-0 [&_label]:mb-[5px] [&_label]:mt-0 [&_label]:text-xs [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:min-w-0">
          <div>
            <label className="my-3 grid gap-[6px] text-xs font-semibold" htmlFor="contextual-repeats">{timing.repeat}</label>
            <SelectField id="contextual-repeats" ariaLabel={timing.repeat} value={repeat}
              onValueChange={value => setRepeat(value as Repeat)}
              options={[
                { value: "2", label: "2×" }, { value: "3", label: "3×" },
                { value: "5", label: "5×" }, { value: "infinite", label: "∞" },
              ]} />
          </div>
          <div>
            <label className="my-3 grid gap-[6px] text-xs font-semibold" htmlFor="contextual-delay">{timing.delay}</label>
            <SelectField id="contextual-delay" ariaLabel={timing.delay} value={String(delay)}
              onValueChange={value => setDelay(Number(value))}
              options={[0, 1, 2, 3].map(seconds => ({
                value: String(seconds), label: seconds + "s",
              }))} />
          </div>
        </div>
        {selectedRange && <div className="grid gap-4 border-t border-border pt-[10px]">
          {(["start", "end"] as const).map(boundary => {
            const point = boundary === "start" ? selectedRange.startMs : selectedRange.endMs;
            const name = boundary === "start" ? timing.loopStart : timing.loopEnd;
            return <div key={boundary}>
              <div className="mb-[9px] flex items-center justify-between gap-2 text-[13px] [&>output]:tabular-nums">
                <strong>{name}</strong>
                <output>{formatLoopTimestamp(point)}</output>
              </div>
              <div className="grid grid-cols-2 gap-[6px] [&>button]:h-auto [&>button]:min-h-[35px] [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:p-[6px] [&>button]:text-xs [&>button:last-child]:col-span-full">
                <Button size="sm" variant="outline" disabled={busy}
                  aria-label={name + " " + timing.loopEarlier}
                  onClick={() => void updateRange(boundary, point - 500)}>−0.5s</Button>
                <Button size="sm" variant="outline" disabled={busy}
                  aria-label={name + " " + timing.loopLater}
                  onClick={() => void updateRange(boundary, point + 500)}>+0.5s</Button>
                <Button size="sm" variant="outline" disabled={busy || !adapter.status}
                  onClick={() => void updateRange(boundary, "current")}>
                  {timing.setBoundaryHere}
                </Button>
              </div>
            </div>;
          })}
          <Button size="sm" variant="ghost" disabled={busy || !selectedCue ||
            !loopRanges[selectedCue.id]} onClick={() => void updateRange("reset")}>
            {timing.loopRangeResetButton}
          </Button>
        </div>}
        {status && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint" role="status">{status}</p>}
      </dialog>
      {status && <p className="mt-[5px] text-[11px] text-muted-foreground wrap-anywhere" role="status">{status}</p>}
    </div>}
  </div>;
}
