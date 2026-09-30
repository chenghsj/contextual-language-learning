import { cn } from "../lib/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Play, Repeat2, SlidersHorizontal, Square } from "lucide-react";
import { formatTime, type LearningDocument, type PronunciationSegment, type SubtitleCue } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { contextualReaderMessages, contextualText } from "../i18n/contextual-reader";
import { pronunciationCopy } from "../i18n/pronunciation";
import { sceneReaderMessages } from "../i18n/scene-reader";
import { playingCueAt } from "../video/cue-follow";
import {
  formatLoopTimestamp, isLoopWindow, readLoopWindows,
  type LoopWindow,
} from "../video/loop-window";
import { cuePlaybackStart, cuePlaybackWindow, openOrFocusVideoTab } from "../video/tab";
import type { VideoAdapter } from "../video/types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { SelectField } from "./ui/select";
import { defaultPronunciationMode, displayReading, pronunciationModes, type PronunciationMode } from "./pronunciation";

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
  sceneRepeat: Repeat;
  setSceneRepeat: (repeat: Repeat) => void;
  sceneDelay: number;
  setSceneDelay: (delay: number) => void;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onSaveRange: (cueId: string, range: LoopWindow | null) => Promise<void>;
  onSaveSceneRange: (sceneId: string, range: LoopWindow | null) => Promise<void>;
};

/** V3 is readable as one cohesive scene. V1/V2 keep their original reader. */
export function ContextualSceneReader({
  document, adapter, locale, repeat, setRepeat, delay, setDelay, sceneRepeat, setSceneRepeat, sceneDelay, setSceneDelay, playbackRate, setPlaybackRate, onError, onNotice, onSaveRange, onSaveSceneRange,
}: Props) {
  const copy = contextualReaderMessages[locale];
  const timing = sceneReaderMessages[locale];
  const targetLanguage = document.profile.targetLanguage;
  const phonetics = pronunciationCopy(locale, targetLanguage);
  const pronunciationKey = "pronunciationMode:" + targetLanguage;
  const [pronunciationMode, setPronunciationMode] = useState<PronunciationMode>(() => defaultPronunciationMode(targetLanguage));
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
  const [loopingSceneId, setLoopingSceneId] = useState<string | null>(null);
  const loopingSceneRef = useRef<string | null>(null);
  const [loopRanges, setLoopRanges] = useState<Record<string, LoopWindow>>({});
  const [sceneRanges, setSceneRanges] = useState<Record<string, LoopWindow>>(() =>
    readLoopWindows(document.scenePlaybackOverrides, document.sections.map(scene => scene.id)));
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationScope, setCalibrationScope] = useState<"cue" | "scene">("cue");
  const cueCalibrationOpen = calibrationOpen && calibrationScope === "cue";
  const sceneCalibrationOpen = calibrationOpen && calibrationScope === "scene";
  const calibrationOpenRef = useRef(false);
  const [calibrationStage, setCalibrationStage] = useState<"start" | "end" | "confirm">("start");
  const [draftStartMs, setDraftStartMs] = useState<number | null>(null);
  const [draftRange, setDraftRange] = useState<LoopWindow | null>(null);
  const previewRef = useRef(false);
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
  const sourceSceneRange = scene.startMs !== null && scene.endMs !== null &&
    scene.endMs > scene.startMs
    ? { startMs: cuePlaybackStart(scene.startMs), endMs: Math.round(scene.endMs) + 400 } : null;
  const selectedSceneRange = sceneRanges[scene.id] ??
    (isLoopWindow(sourceSceneRange) ? sourceSceneRange : null);
  const supportsCue = (cue: SubtitleCue | undefined): cue is SubtitleCue =>
    !!cue && cue.startMs !== null && cue.endMs !== null && cue.endMs > cue.startMs;

  useEffect(() => {
    let live = true;
    setPronunciationMode(defaultPronunciationMode(targetLanguage));
    void chrome.storage.local.get(pronunciationKey).then(saved => {
      const candidate = saved[pronunciationKey] as PronunciationMode;
      if (live && pronunciationModes(targetLanguage).includes(candidate)) setPronunciationMode(candidate);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [pronunciationKey, targetLanguage]);

  function choosePronunciation(mode: PronunciationMode): void {
    setPronunciationMode(mode);
    void chrome.storage.local.set({ [pronunciationKey]: mode }).catch(() => undefined);
  }

  function annotatedText(text: string, segments?: PronunciationSegment[]): React.ReactNode {
    if (pronunciationMode === "off" || !segments?.length || segments.map(item => item.text).join("") !== text) return text;
    return segments.map((item, index) => {
      const reading = displayReading(targetLanguage, pronunciationMode, item.reading);
      if (reading && Array.from(item.text).length > 14) return <span key={index} className="inline-block max-w-full min-w-0 align-top">
        <span className="block wrap-anywhere">{item.text}</span>
        <span className="block text-[10px] leading-[1.6] text-muted-foreground wrap-anywhere">{reading}</span>
      </span>;
      return reading ? <ruby key={index} className="ruby-[position:over] leading-[2.2]">{item.text}<rp>(</rp><rt className="text-[10px] font-normal text-muted-foreground">{reading}</rt><rp>)</rp></ruby>
        : <React.Fragment key={index}>{item.text}</React.Fragment>;
    });
  }

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
      setLoopRanges(readLoopWindows(document.playbackOverrides === undefined
        ? saved[loopKey] : document.playbackOverrides, document.cues.map(cue => cue.id)));
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

  useEffect(() => {
    setSceneRanges(readLoopWindows(document.scenePlaybackOverrides, document.sections.map(item => item.id)));
  }, [document.scenePlaybackOverrides, document.sections]);

  useEffect(() => { loopingCueRef.current = loopingCueId; }, [loopingCueId]);
  useEffect(() => { loopingSceneRef.current = loopingSceneId; }, [loopingSceneId]);
  useEffect(() => () => {
    // A closed reader must not leave a video loop controlling the old scene.
    if ((loopingCueRef.current || loopingSceneRef.current || previewRef.current) && sourceUrl && adapter.stopLoop) {
      void adapter.stopLoop(sourceUrl).catch(() => undefined);
    }
  }, [sourceUrl, adapter]);
  useEffect(() => { calibrationOpenRef.current = calibrationOpen; }, [calibrationOpen]);
  // A scene/cue change must discard an unfinished calibration draft.
  useEffect(() => {
    setCalibrationOpen(false);
    setCalibrationStage("start");
    setDraftStartMs(null);
    setDraftRange(null);
  }, [scene.id, selectedCueId]);

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
    const active = !!loopingCueRef.current || !!loopingSceneRef.current || previewRef.current;
    previewRef.current = false;
    loopingCueRef.current = null;
    loopingSceneRef.current = null;
    setLoopingCueId(null);
    setLoopingSceneId(null);
    if (active && sourceUrl && adapter.stopLoop) await adapter.stopLoop(sourceUrl);
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
    if (!sourceUrl || !adapter.loop || !selectedSceneRange) return;
    markBusy(true);
    try {
      await stopPreviousLoop();
      await adapter.loop(sourceUrl, { ...selectedSceneRange, repeats: 1, delaySeconds: 0 });
      onNotice(copy.playbackStarted);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally { markBusy(false); }
  }

  async function toggleSceneLoop(): Promise<void> {
    if (!sourceUrl || !adapter.loop || !adapter.stopLoop || busy || !selectedSceneRange) return;
    markBusy(true);
    try {
      if (loopingSceneRef.current === scene.id) {
        await stopPreviousLoop();
        onNotice(copy.sceneLoopStopped);
      } else {
        await stopPreviousLoop();
        await adapter.loop(sourceUrl, {
          ...selectedSceneRange,
          repeats: sceneRepeat === "infinite" ? "infinite" : Number(sceneRepeat),
          delaySeconds: sceneDelay,
        });
        loopingSceneRef.current = scene.id;
        setLoopingSceneId(scene.id);
        onNotice(copy.sceneLoopStarted);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally { markBusy(false); }
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
        onNotice(resumeLoop ? copy.loopStarted : copy.playbackStarted);
      } else if (play && !supportsCue(cue)) {
        onNotice(copy.noTime);
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
        onNotice(copy.loopStopped);
      } else {
        await stopPreviousLoop();
        await adapter.loop(sourceUrl, {
          ...(loopRanges[selectedCue.id] ?? cuePlaybackWindow(selectedCue.startMs!, selectedCue.endMs!)),
          repeats: repeat === "infinite" ? "infinite" : Number(repeat),
          delaySeconds: delay,
        });
        loopingCueRef.current = selectedCue.id;
        setLoopingCueId(selectedCue.id);
        onNotice(copy.loopStarted);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  function cancelCalibration(): void {
    setCalibrationScope("cue");
    if (previewRef.current && sourceUrl && adapter.stopLoop) {
      previewRef.current = false;
      void adapter.stopLoop(sourceUrl).catch(() => undefined);
    }
    setCalibrationOpen(false);
    setCalibrationStage("start");
    setDraftStartMs(null);
    setDraftRange(null);
  }

  async function openCalibration(scope: "cue" | "scene"): Promise<void> {
    if (busyRef.current) return;
    markBusy(true);
    try {
      await stopPreviousLoop();
      setCalibrationStage("start");
      setDraftStartMs(null);
      setDraftRange(null);
      setStatus("");
      setCalibrationScope(scope);
      setCalibrationOpen(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally { markBusy(false); }
  }

  /** Rewind the player after hearing a sound; no prediction of the exact syllable onset needed. */
  async function rewindCalibration(): Promise<void> {
    if (busyRef.current || !sourceUrl || !adapter.status || !adapter.seek) return;
    markBusy(true);
    try {
      const playback = await adapter.status(sourceUrl);
      if (typeof playback.currentMs !== "number" || !Number.isFinite(playback.currentMs) ||
          playback.currentMs < 0) { setStatus(timing.positionUnavailable); return; }
      await stopPreviousLoop();
      await adapter.seek(sourceUrl, Math.max(0, Math.round(playback.currentMs) - 3_000));
      setStatus(copy.rewound);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally { markBusy(false); }
  }

  function adjustDraftStart(delta: number): void {
    if (!draftRange) return;
    const candidate = { ...draftRange, startMs: Math.max(0, draftRange.startMs + delta) };
    if (!isLoopWindow(candidate)) { setStatus(timing.invalidLoopRange); return; }
    setDraftRange(candidate);
    setStatus("");
  }

  async function previewCalibration(): Promise<void> {
    if (busyRef.current || !sourceUrl || !adapter.loop || !draftRange) return;
    markBusy(true);
    try {
      await stopPreviousLoop();
      await adapter.loop(sourceUrl, { ...draftRange, repeats: 1, delaySeconds: 0 });
      previewRef.current = true;
      setStatus(copy.previewStarted);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally { markBusy(false); }
  }

  /** Capture real player time; persist nothing before Done. */
  async function captureBoundary(boundary: "start" | "end"): Promise<void> {
    if (busyRef.current || !sourceUrl || !adapter.status ||
        (calibrationScope === "cue" && !selectedCue) ||
        (calibrationScope === "scene" && !selectedSceneRange)) return;
    markBusy(true);
    try {
      const playback = await adapter.status(sourceUrl);
      if (typeof playback.currentMs !== "number" || !Number.isFinite(playback.currentMs) ||
          playback.currentMs < 0) {
        setStatus(timing.positionUnavailable);
        return;
      }
      const position = Math.round(playback.currentMs / 100) * 100;
      if (boundary === "start") {
        setDraftStartMs(position);
        setCalibrationStage("end");
      } else {
        if (draftStartMs === null) return;
        const next = { startMs: draftStartMs, endMs: position };
        if (!isLoopWindow(next)) { setStatus(timing.invalidLoopRange); return; }
        setDraftRange(next);
        setCalibrationStage("confirm");
      }
      setStatus("");
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally { markBusy(false); }
  }

  function keepCurrentBoundary(boundary: "start" | "end"): void {
    const currentRange = calibrationScope === "scene" ? selectedSceneRange : selectedRange;
    if (busyRef.current || !currentRange) return;
    if (boundary === "start") {
      setDraftStartMs(currentRange.startMs);
      setCalibrationStage("end");
    } else {
      if (draftStartMs === null) return;
      const next = { startMs: draftStartMs, endMs: currentRange.endMs };
      if (!isLoopWindow(next)) { setStatus(timing.invalidLoopRange); return; }
      setDraftRange(next);
      setCalibrationStage("confirm");
    }
    setStatus("");
  }

  async function finishCalibration(): Promise<void> {
    if (busyRef.current || calibrationStage !== "confirm" ||
        (calibrationScope === "cue" && !selectedCue)) return;
    if (draftRange && !isLoopWindow(draftRange)) { setStatus(timing.invalidLoopRange); return; }
    markBusy(true);
    try {
      await stopPreviousLoop();
      if (calibrationScope === "scene") {
        await onSaveSceneRange(scene.id, draftRange);
        setSceneRanges(previous => {
          const updated = { ...previous };
          if (draftRange) updated[scene.id] = draftRange;
          else delete updated[scene.id];
          return updated;
        });
      } else if (selectedCue) {
        const cueId = selectedCue.id;
        await onSaveRange(cueId, draftRange);
        setLoopRanges(previous => {
          const updated = { ...previous };
          if (draftRange) updated[cueId] = draftRange;
          else delete updated[cueId];
          return updated;
        });
      }
      onNotice(draftRange ? timing.loopRangeSaved : timing.loopRangeReset);
      cancelCalibration();
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
      onNotice(copy.videoOpened);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      markBusy(false);
    }
  }

  function renderCalibration(scope: "cue" | "scene") {
    const currentRange = scope === "scene" ? selectedSceneRange : selectedRange;
    const hasSavedRange = scope === "scene" ? !!sceneRanges[scene.id] :
      !!(selectedCue && loopRanges[selectedCue.id]);
    return calibrationOpen && calibrationScope === scope && currentRange && <section id={scope === "scene" ? "contextual-scene-calibration" : "contextual-inline-calibration"}
        className="mt-2 grid gap-3 rounded-[var(--radius)] border border-border bg-muted/50 p-3 text-xs"
        aria-label={scope === "scene" ? copy.adjustScene : copy.adjustPosition}>
        <div className="flex items-center gap-2 border-b border-border pb-2 font-semibold text-foreground">
          <SlidersHorizontal aria-hidden="true" className="size-4" />{scope === "scene" ? copy.adjustScene : copy.adjustPosition}
          <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground tabular-nums">
            {calibrationStage === "start" ? "1 / 3" : calibrationStage === "end" ? "2 / 3" : "3 / 3"}
          </span>
        </div>
        {calibrationStage === "start" && <>
          <p className="m-0 text-foreground">{scope === "scene" ? copy.calibrateSceneStart : copy.calibrateStart}</p>
          <div className="flex flex-wrap items-center gap-2">
            {adapter.seek && <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void rewindCalibration()}>{copy.rewind3}</Button>}
            <Button size="sm" disabled={busy} onClick={() => void captureBoundary("start")}>
              {copy.markStart}
            </Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => keepCurrentBoundary("start")}>{copy.keepStart}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancelCalibration}>
              {copy.cancelTiming}
            </Button>
          </div>
        </>}
        {calibrationStage === "end" && <>
          <p className="m-0 text-foreground">{scope === "scene" ? copy.calibrateSceneEnd : copy.calibrateEnd}</p>
          <div className="flex flex-wrap items-center gap-2">
            {adapter.seek && <Button size="sm" variant="outline" disabled={busy}
              onClick={() => void rewindCalibration()}>{copy.rewind3}</Button>}
            <Button size="sm" disabled={busy} onClick={() => void captureBoundary("end")}>
              {copy.markEnd}
            </Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => keepCurrentBoundary("end")}>{copy.keepEnd}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancelCalibration}>
              {copy.cancelTiming}
            </Button>
          </div>
        </>}
        {calibrationStage === "confirm" && <>
          <p className="m-0 tabular-nums text-muted-foreground">
            {draftRange ? formatLoopTimestamp(draftRange.startMs) + " – " +
              formatLoopTimestamp(draftRange.endMs) : copy.restoreTiming}
          </p>
          {draftRange && <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => adjustDraftStart(-500)}>{copy.startEarlier}</Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => adjustDraftStart(500)}>{copy.startLater}</Button>
            <Button size="sm" variant="outline" className="col-span-2" disabled={busy || !adapter.loop}
              onClick={() => void previewCalibration()}><Play aria-hidden="true" />{copy.preview}</Button>
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => void finishCalibration()}>
              {copy.saveTiming}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancelCalibration}>
              {copy.cancelTiming}
            </Button>
          </div>
        </>}
        {calibrationStage !== "confirm" && hasSavedRange &&
          <Button size="sm" variant="ghost" className="w-fit text-muted-foreground"
            disabled={busy} onClick={() => { setDraftRange(null); setCalibrationStage("confirm"); }}>
            {copy.restoreTiming}
          </Button>}
        {status && <p className="m-0 text-xs text-muted-foreground wrap-anywhere" role="status">{status}</p>}
      </section>;
  }

  return <div className="min-w-0">
    <Card className="mb-3 min-w-0 max-w-full p-3 wrap-anywhere">
      <div className="min-w-0">
        <div className="min-w-0 flex-1 [&>strong]:block [&>strong]:text-[13px] [&>strong]:wrap-anywhere [&_[data-ui=hint]]:my-[3px]">
          <strong>{document.source.title}</strong>
          <span className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</span>
        </div>
      </div>
      <div className="mt-2 min-w-0" role="group" aria-label={phonetics.title}>
        <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">{phonetics.title}</span>
        <div className="flex min-w-0 flex-wrap gap-1">
          {pronunciationModes(targetLanguage).map(mode => <Button key={mode} size="sm"
            className="h-8 min-w-0 px-2 text-[11px]" variant={pronunciationMode === mode ? "secondary" : "outline"}
            aria-pressed={pronunciationMode === mode} onClick={() => choosePronunciation(mode)}>
            {phonetics.option(mode)}
          </Button>)}
        </div>
        {pronunciationMode === "zhuyin" && <p className="mt-1 text-[11px] text-muted-foreground">{phonetics.approximate}</p>}
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

    <Card className="mb-3 min-w-0 max-w-full px-3 py-[14px] wrap-anywhere [&_h2]:mt-[5px] [&_h2]:mb-0 [&_h2]:text-[17px] [&_h3]:m-0 [&_h3]:text-sm [&_h3]:normal-case [&_h3]:tracking-normal [&_h3]:text-foreground">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div>
          <span className="text-[11px] text-muted-foreground tabular-nums">{selectedSceneRange && sceneRanges[scene.id]
              ? formatLoopTimestamp(selectedSceneRange.startMs) + "–" +
                formatLoopTimestamp(selectedSceneRange.endMs) + " · " + copy.adjusted
              : formatTime(scene.startMs) + "–" + formatTime(scene.endMs)}</span>
          <h2>{scene.title}</h2>
        </div>
        {sourceUrl && adapter.id !== "import" && <Button size="icon" variant="ghost"
          aria-label={copy.video} disabled={busy} onClick={() => void openVideo()}>
          <ExternalLink aria-hidden="true" />
        </Button>}
      </div>
      <p className="my-[8px_12px] text-[13px] leading-[1.6] text-muted-foreground">{scene.context}</p>
      <div className="grid grid-cols-2 gap-2 [&>button]:min-h-[38px] [&>button]:min-w-0 [&>button]:h-auto [&>button]:whitespace-normal">
        <Button variant="outline" disabled={busy || !canLoop || !selectedSceneRange} onClick={() => void playScene()}>
          <Play aria-hidden="true" />{copy.playScene}
        </Button>
        <Button variant={loopingSceneId === scene.id ? "secondary" : "outline"}
          disabled={busy || !canLoop || !adapter.stopLoop || !selectedSceneRange}
          aria-pressed={loopingSceneId === scene.id} onClick={() => void toggleSceneLoop()}>
          {loopingSceneId === scene.id ? <Square aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}
          {loopingSceneId === scene.id ? copy.stopSceneLoop : copy.loopScene + " · " +
            (sceneRepeat === "infinite" ? "∞" : sceneRepeat + "×")}
        </Button>
      </div>
      {!canLoop && <p className="my-[7px_12px] text-xs leading-[1.55] text-muted-foreground" data-ui="hint">{copy.noVideo}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2 max-[355px]:grid-cols-1 [&>button]:h-auto [&>button]:min-h-9 [&>button]:whitespace-normal">
        <details className="min-w-0 rounded-[var(--radius)] border border-border bg-muted/50 px-2 py-[7px] text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">{copy.sceneLoopOptions}</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 [&_[data-slot=select-trigger]]:w-full">
            <label className="grid gap-1">{timing.repeat}<SelectField ariaLabel={copy.sceneLoopOptions + " · " + timing.repeat}
              value={sceneRepeat} disabled={busy} onValueChange={value => setSceneRepeat(value as Repeat)}
              options={[{ value: "2", label: "2×" }, { value: "3", label: "3×" }, { value: "5", label: "5×" }, { value: "infinite", label: "∞" }]} /></label>
            <label className="grid gap-1">{timing.delay}<SelectField ariaLabel={copy.sceneLoopOptions + " · " + timing.delay}
              value={String(sceneDelay)} disabled={busy} onValueChange={value => setSceneDelay(Number(value))}
              options={[0, 1, 2, 3].map(value => ({ value: String(value), label: value + "s" }))} /></label>
          </div>
        </details>
        {sourceUrl && adapter.status && adapter.loop && selectedSceneRange && !sceneCalibrationOpen && <Button variant="outline" size="sm" disabled={busy}
          aria-expanded={false}
          aria-controls="contextual-scene-calibration"
          onClick={() => void openCalibration("scene")}>
          <SlidersHorizontal aria-hidden="true" />{copy.adjustScene}
        </Button>}
      </div>
      {sourceUrl && adapter.status && adapter.loop && selectedSceneRange && <div className="mt-2 grid gap-2">
        {renderCalibration("scene")}
      </div>}

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
              <span lang={document.profile.targetLanguage}>{annotatedText(cue.originalText, scene.pronunciations?.find(item => item.cueId === cue.id)?.segments)}</span>
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
                      <p lang={document.profile.targetLanguage}>{annotatedText(line.text, line.pronunciation)}</p>
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
      <div className="mt-2 grid grid-cols-[36px_minmax(0,1fr)_36px_74px] items-center gap-[5px] [&>button]:w-full [&>button]:min-w-0 [&>[data-slot=select-trigger]]:w-full [&>[data-slot=select-trigger]]:min-w-0 [&>[data-slot=select-trigger]]:px-[6px] [&>[data-slot=select-trigger]]:text-xs max-[355px]:grid-cols-[32px_minmax(0,1fr)_32px_60px] max-[355px]:gap-1 max-[355px]:[&>[data-slot=select-trigger]]:px-[3px] min-[480px]:grid-cols-[36px_minmax(0,1fr)_36px_74px_90px]">
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
          options={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => ({
            value: String(rate), label: rate + "×",
          }))} />}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 max-[355px]:grid-cols-1">
      <details className="min-w-0 rounded-[var(--radius)] border border-border bg-muted/50 px-2 py-[6px] text-xs">
        <summary className="cursor-pointer font-semibold text-foreground">{copy.cueLoopOptions}</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 [&_[data-slot=select-trigger]]:w-full">
          <label className="grid gap-1">{timing.repeat}
            <SelectField ariaLabel={timing.repeat} value={repeat} disabled={busy}
              onValueChange={value => setRepeat(value as Repeat)}
              options={[{ value: "2", label: "2×" }, { value: "3", label: "3×" },
                { value: "5", label: "5×" }, { value: "infinite", label: "∞" }]} />
          </label>
          <label className="grid gap-1">{timing.delay}
            <SelectField ariaLabel={timing.delay} value={String(delay)} disabled={busy}
              onValueChange={value => setDelay(Number(value))}
              options={[0, 1, 2, 3].map(seconds => ({
                value: String(seconds), label: seconds + "s",
              }))} />
          </label>
        </div>
      </details>
      {!cueCalibrationOpen && <Button size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal"
        aria-expanded={false} aria-controls="contextual-inline-calibration"
        disabled={busy || !selectedRange || !adapter.status}
        onClick={() => void openCalibration("cue")}>
        <SlidersHorizontal aria-hidden="true" />{copy.adjustPosition}
      </Button>}
      </div>
      {renderCalibration("cue")}
    </div>}
  </div>;
}
