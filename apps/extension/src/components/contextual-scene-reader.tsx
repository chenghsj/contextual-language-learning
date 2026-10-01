import { IconTooltipContent } from "./icon-tooltip";
import { PlaybackTimeline } from "./playback-timeline";
import { readStudyProgress, recordSceneVisit, studyProgressKey } from "../lib/study-progress";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, MoreHorizontal, Pause, Play, Repeat2, WholeWord, SkipBack, SkipForward, X } from "lucide-react";
import { type LearningDocument, type PronunciationSegment, type SubtitleCue } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { contextualReaderMessages } from "../i18n/contextual-reader";
import { unifiedPlayerMessages } from "../i18n/unified-player";
import { pronunciationCopy } from "../i18n/pronunciation";
import { playbackTimingMessages } from "../i18n/playback-timing";
import { playingCueAt } from "../video/cue-follow";
import { formatLoopTimestamp, isLoopWindow, type LoopWindow } from "../video/loop-window";
import { effectiveCueWindow, scenePlaybackWindow } from "../video/reader-playback";
import { openOrFocusVideoTab } from "../video/tab";
import { useVideoReaderHealth } from "../hooks/use-video-reader-health";
import type { VideoAdapter } from "../video/types";
import { SceneFocusItems } from "./scene-focus-items";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import { SelectField } from "./ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { defaultPronunciationMode, displayReading, japaneseKanjiAnnotations, pronunciationModes, romanAnnotations, type PronunciationMode } from "./pronunciation";

type ContextualDocument = LearningDocument;
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

type PlaybackTarget = { type: "scene"; sceneId: string } | { type: "sentence"; sceneId: string; sentenceId: string };

/** Scene navigation and one player frame the independently scrolling lesson. */
export function ContextualSceneReader({ document, adapter, locale, playbackRate, setPlaybackRate,
  onError, onNotice, onSaveRange, onSaveSceneRange }: Props) {
  const copy = contextualReaderMessages[locale];
  const ui = unifiedPlayerMessages[locale];
  const timing = playbackTimingMessages[locale];
  const targetLanguage = document.profile.targetLanguage;
  const phonetics = pronunciationCopy(locale, targetLanguage);
  const pronunciationKey = "pronunciationMode:" + targetLanguage;
  const [pronunciationMode, setPronunciationMode] = useState<PronunciationMode>(() => defaultPronunciationMode(targetLanguage));
  const cues = useMemo(() => new Map(document.cues.map(cue => [cue.id, cue])), [document.cues]);
  const playbackCues = useMemo(() => new Map(document.cues.map(cue => [cue.id, { ...cue, ...document.playbackOverrides?.[cue.id] }])), [document.cues, document.playbackOverrides]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = document.sections[sceneIndex] ?? document.sections[0];
  const lines = scene.cueIds.map(id => cues.get(id)).filter((cue): cue is SubtitleCue => !!cue);
  const [target, setTarget] = useState<PlaybackTarget>({ type: "scene", sceneId: scene.id });
  const [translationVisible, setTranslationVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [targetStarted, setTargetStarted] = useState(false);
  const [currentMs, setCurrentMs] = useState<number | null>(null);
  const [playingCueId, setPlayingCueId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftReset, setDraftReset] = useState(false);
  const [draft, setDraft] = useState<LoopWindow | null>(null);
  const [status, setStatus] = useState("");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pronunciationOpen, setPronunciationOpen] = useState(false);
  const [pronunciationTooltipVisible, setPronunciationTooltipVisible] = useState(false);
  const pronunciationTooltipId = React.useId();
  const [videoTooltipVisible, setVideoTooltipVisible] = useState(false);
  const videoTooltipId = React.useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const managedRef = useRef(false);
  const mountedRef = useRef(true);
  const sourceUrl = document.source.url;
  const { needsReload, recheck } = useVideoReaderHealth(adapter, sourceUrl, false);
  const selectedCue = target.type === "sentence" ? cues.get(target.sentenceId) : undefined;
  const selectedIndex = selectedCue ? scene.cueIds.indexOf(selectedCue.id) : -1;
  const range = target.type === "sentence" ? effectiveCueWindow(selectedCue, document.playbackOverrides ?? {})
    : document.scenePlaybackOverrides?.[scene.id] ?? scenePlaybackWindow(scene.startMs, scene.endMs);
  const sceneRange = document.scenePlaybackOverrides?.[scene.id] ?? scenePlaybackWindow(scene.startMs, scene.endMs);
  const targetTitle = selectedCue?.originalText ?? scene.title;
  const canPlay = !needsReload && !!sourceUrl && !!adapter.loop && !!range;
  const progressKey = studyProgressKey(document.id);
  const studyProgressRef = useRef<unknown>(null);
  const hasDisplayableReading = (text: string, segments?: PronunciationSegment[]): boolean =>
    !!segments?.length && segments.map(item => item.text).join("") === text &&
    (pronunciationMode === "native" && targetLanguage === "ja"
      ? segments.some(item => !!item.reading && japaneseKanjiAnnotations(item.text, item.reading).some(piece => !!piece.reading))
      : pronunciationMode === "roman"
        ? !!romanAnnotations(targetLanguage, text, segments)
        : segments.some(item => !!displayReading(targetLanguage, pronunciationMode, item.reading)));
  const hasSceneReading = scene.pronunciations?.some(item => {
    const cue = lines.find(line => line.id === item.cueId);
    return !!cue && hasDisplayableReading(cue.originalText, item.segments);
  }) || scene.focusItems.some(item => item.examples.some(example =>
    example.dialogue.some(line => hasDisplayableReading(line.text, line.pronunciation))));

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
    if (pronunciationMode === "roman") {
      const parts = romanAnnotations(targetLanguage, text, segments);
      return parts ? parts.map((part, index) => part.reading
        ? <span key={index}>{part.text}<span lang={targetLanguage === "ja" ? "ja-Latn" : "ko-Latn"} className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">（{part.reading}）</span></span>
        : <React.Fragment key={index}>{part.text}</React.Fragment>) : text;
    }
    if (pronunciationMode === "native" && targetLanguage === "ja") return segments.flatMap((item, index) =>
      item.reading ? japaneseKanjiAnnotations(item.text, item.reading).map((piece, pieceIndex) =>
        piece.reading ? Array.from(piece.reading).length > Array.from(piece.text).length * 2 + 1
          ? <span key={`${index}-${pieceIndex}`}>{piece.text}<span className="text-[11px] text-muted-foreground">（{piece.reading}）</span></span>
          : <ruby key={`${index}-${pieceIndex}`} className="ruby-[position:over] leading-[2.2]">{piece.text}<rp>(</rp><rt className="text-[8px] font-normal text-muted-foreground">{piece.reading}</rt><rp>)</rp></ruby>
          : <React.Fragment key={`${index}-${pieceIndex}`}>{piece.text}</React.Fragment>)
        : [<React.Fragment key={index}>{item.text}</React.Fragment>]);
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
    void chrome.storage.local.get(progressKey).then(saved => {
      const restored = readStudyProgress(saved[progressKey], document.sections.map(scene => scene.id));
      studyProgressRef.current = restored;
      const id = restored.sceneId;
      const index = document.sections.findIndex(item => item.id === id);
      if (live && index >= 0 && id) { setSceneIndex(index); setTarget({ type: "scene", sceneId: id }); }
      if (live && document.sections[0]) {
        studyProgressRef.current = recordSceneVisit(restored, id ?? document.sections[0].id, document.sections.map(scene => scene.id));
        void chrome.storage.local.set({ [progressKey]: studyProgressRef.current }).catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => { live = false; };
  }, [document.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (managedRef.current && sourceUrl && adapter.stopLoop) void adapter.stopLoop(sourceUrl).catch(() => undefined);
    };
  }, [adapter, sourceUrl]);

  useEffect(() => {
    if (!sourceUrl || !adapter.status) return;
    let live = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || busyRef.current) return;
      inFlight = true;
      try {
        const state = await adapter.status!(sourceUrl);
        if (!live || busyRef.current) return;
        setCurrentMs(typeof state.currentMs === "number" && Number.isFinite(state.currentMs) ? state.currentMs : null);
        setPlaying((editing || targetStarted) && state.playing === true);
        const active = target.type === "sentence" && selectedCue && range ? { cueId: selectedCue.id, ...range } : null;
        setPlayingCueId(targetStarted && typeof state.currentMs === "number" ? playingCueAt(scene.cueIds, playbackCues, state.currentMs, active) : null);
      } catch { if (live) { setCurrentMs(null); setPlaying(false); setPlayingCueId(null); } }
      finally { inFlight = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 300);
    return () => { live = false; window.clearInterval(timer); };
  }, [sourceUrl, adapter, scene, target, selectedCue, range?.startMs, range?.endMs, playbackCues, editing, targetStarted]);

  async function command(action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setStatus("");
    try { await action(); }
    catch (error) { onError(error instanceof Error ? error.message : copy.unavailable); }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(false); }
  }

  async function stopManaged(): Promise<void> {
    if (sourceUrl && adapter.stopLoop) await adapter.stopLoop(sourceUrl);
    managedRef.current = false;
  }

  async function startRange(next: LoopWindow, resumeMs?: number, repeat = loop, trackTarget = true): Promise<void> {
    if (!sourceUrl || !adapter.loop) return;
    await stopManaged();
    if (adapter.setPlaybackRate) await adapter.setPlaybackRate(sourceUrl, playbackRate);
    await adapter.loop(sourceUrl, { ...next, repeats: repeat ? "infinite" : 1, delaySeconds: 0, resumeMs });
    if (trackTarget) setTargetStarted(true);
    managedRef.current = true; setPlaying(true); setCurrentMs(resumeMs ?? next.startMs);
  }

  function chooseScene(index: number): void {
    if (index < 0 || index >= document.sections.length || index === sceneIndex) return;
    void command(async () => {
      if (managedRef.current) {
        await stopManaged();
        if (sourceUrl && adapter.pause) await adapter.pause(sourceUrl);
      }
      const next = document.sections[index];
      setTargetStarted(false);
      setSceneIndex(index); setTarget({ type: "scene", sceneId: next.id });
      setEditing(false); setDraft(null); setPlaying(false); setPlayingCueId(null);
      setTranslationVisible(false); contentRef.current?.scrollTo({ top: 0 });
      studyProgressRef.current = recordSceneVisit(studyProgressRef.current, next.id, document.sections.map(scene => scene.id));
      void chrome.storage.local.set({ [progressKey]: studyProgressRef.current }).catch(() => undefined);
    });
  }

  function playScene(): void {
    if (!sceneRange) return;
    void command(async () => {
      setEditing(false); setTarget({ type: "scene", sceneId: scene.id });
      await startRange(sceneRange);
    });
  }

  function selectCue(id: string): void {
    const cue = cues.get(id);
    const next = effectiveCueWindow(cue, document.playbackOverrides ?? {});
    void command(async () => {
      setEditing(false); setTargetStarted(false); setTarget({ type: "sentence", sceneId: scene.id, sentenceId: id });
      if (next && sourceUrl && adapter.loop) await startRange(next);
      else { await stopManaged(); onNotice(copy.noTime); }
    });
  }

  function togglePlayback(): void {
    if (!sourceUrl) return;
    void command(async () => {
      if (playing && adapter.pause) { await stopManaged(); await adapter.pause(sourceUrl); setPlaying(false); }
      else if (editing && adapter.play) { await stopManaged(); await adapter.play(sourceUrl); setPlaying(true); }
      else if (range) await startRange(range, targetStarted && currentMs !== null && currentMs >= range.startMs && currentMs < range.endMs - 100 ? currentMs : undefined);
    });
  }

  function jump(position: number): void {
    if (!sourceUrl || !adapter.seek) return;
    void command(async () => {
      const next = Math.max(0, Math.round(position));
      if (editing) {
        await stopManaged(); await adapter.seek!(sourceUrl, next);
        if (!playing && adapter.pause) await adapter.pause(sourceUrl);
        setCurrentMs(next);
      } else if (range) await startRange(range, Math.min(range.endMs - 1, Math.max(range.startMs, next)));
    });
  }

  function openTiming(): void {
    if (!range) return;
    void command(async () => {
      await stopManaged(); setLoop(false); setDraft({ ...range }); setDraftReset(false); setEditing(true); setOptionsOpen(false);
    });
  }

  function adjustBoundary(boundary: "startMs" | "endMs", delta: number): void {
    if (!draft || busy) return;
    const next = { ...draft, [boundary]: Math.max(0, draft[boundary] + delta) };
    if (!isLoopWindow(next)) { setStatus(timing.invalidLoopRange); return; }
    setDraft(next); setDraftReset(false); setStatus("");
  }

  function testBoundary(boundary: "startMs" | "endMs"): void {
    if (!draft) return;
    const point = draft[boundary];
    void command(async () => {
      await startRange({ startMs: Math.max(0, point - 1000), endMs: point + 1000 }, undefined, false, false);
    });
  }

  function closeTiming(): void {
    void command(async () => { await stopManaged(); if (sourceUrl && adapter.pause) await adapter.pause(sourceUrl); setPlaying(false); setEditing(false); setDraft(null); });
  }

  function saveTiming(next: LoopWindow | null): void {
    void command(async () => {
      await stopManaged();
      if (sourceUrl && adapter.pause) await adapter.pause(sourceUrl);
      if (target.type === "sentence") await onSaveRange(target.sentenceId, next);
      else await onSaveSceneRange(target.sceneId, next);
      setEditing(false); setDraft(null); setOptionsOpen(false); setPlaying(false);
      onNotice(next ? timing.loopRangeSaved : timing.loopRangeReset);
    });
  }

  const previousDisabled = target.type === "scene" ? sceneIndex === 0 : selectedIndex <= 0;
  const nextDisabled = target.type === "scene" ? sceneIndex === document.sections.length - 1 : selectedIndex >= scene.cueIds.length - 1;
  const previousLabel = target.type === "scene" ? copy.previousScene : copy.previousCue;
  const nextLabel = target.type === "scene" ? copy.nextScene : copy.nextCue;
  const hasOverride = target.type === "scene" ? !!document.scenePlaybackOverrides?.[scene.id] : !!document.playbackOverrides?.[target.sentenceId];

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-t-xl border border-border bg-card" data-ui="unifiedReader">
    <header className="shrink-0 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[11px] text-muted-foreground">{targetLanguage.toUpperCase()} · {document.profile.level}</p>
          <strong className="block truncate text-xs" title={document.source.title}>{document.source.title}</strong>
        </div>
        <Popover open={pronunciationOpen} onOpenChange={open => { setPronunciationOpen(open); setPronunciationTooltipVisible(false); }}>
          <span className="relative inline-flex shrink-0"
            onMouseEnter={() => { if (!pronunciationOpen) setPronunciationTooltipVisible(true); }} onMouseLeave={() => setPronunciationTooltipVisible(false)}
            onFocus={() => { if (!pronunciationOpen) setPronunciationTooltipVisible(true); }} onBlur={() => setPronunciationTooltipVisible(false)}
            onKeyDown={event => { if (event.key === "Escape") setPronunciationTooltipVisible(false); }}>
            <PopoverTrigger asChild><Button size="icon" variant="ghost" className="[&_svg]:size-3.5 size-8" aria-label={phonetics.title}
              aria-describedby={pronunciationTooltipVisible ? pronunciationTooltipId : undefined}><WholeWord aria-hidden="true" /></Button></PopoverTrigger>
            {pronunciationTooltipVisible && <IconTooltipContent id={pronunciationTooltipId}>{phonetics.title}</IconTooltipContent>}
          </span>
          <PopoverContent align="end" className="w-64 max-w-[calc(100vw-24px)] p-3">
            <p className="mb-2 text-xs font-semibold">{phonetics.title}</p>
            <ToggleGroup type="single" variant="default" size="sm" value={pronunciationMode} className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1"
              aria-label={phonetics.title} onValueChange={mode => { if (mode) choosePronunciation(mode as PronunciationMode); }}>
              {pronunciationModes(targetLanguage).map(mode => <ToggleGroupItem key={mode} value={mode} className="h-7 min-w-0 rounded-md px-2 text-xs font-medium data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs">{phonetics.option(mode)}</ToggleGroupItem>)}
            </ToggleGroup>
            {pronunciationMode !== "off" && !hasSceneReading && <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" role="status">{phonetics.unavailable}</p>}
          </PopoverContent>
        </Popover>
        {sourceUrl && adapter.id !== "import" && <span className="relative inline-flex shrink-0"
          onMouseEnter={() => setVideoTooltipVisible(true)} onMouseLeave={() => setVideoTooltipVisible(false)}
          onFocus={() => setVideoTooltipVisible(true)} onBlur={() => setVideoTooltipVisible(false)}
          onKeyDown={event => { if (event.key === "Escape") setVideoTooltipVisible(false); }}>
          <Button size="icon" variant="ghost" className="[&_svg]:size-3.5 size-8" aria-label={copy.video}
            aria-describedby={videoTooltipVisible ? videoTooltipId : undefined} disabled={busy}
            onClick={() => void command(async () => { setVideoTooltipVisible(false); await openOrFocusVideoTab(adapter, sourceUrl); recheck(); })}><ExternalLink aria-hidden="true" /></Button>
          {videoTooltipVisible && <IconTooltipContent id={videoTooltipId}>{copy.video}</IconTooltipContent>}
        </span>}
      </div>
      <nav className="mt-2 grid grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2" aria-label={copy.chooseScene}>
        <Button size="icon" variant="ghost" className="[&_svg]:size-3.5 size-8" aria-label={copy.previousScene} disabled={busy || sceneIndex === 0} onClick={() => chooseScene(sceneIndex - 1)}><ChevronLeft aria-hidden="true" /></Button>
        <SelectField className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs" id="contextual-scene-picker" ariaLabel={copy.chooseScene} value={String(sceneIndex)} disabled={busy}
          onValueChange={value => chooseScene(Number(value))} options={document.sections.map((item, index) => ({ value: String(index), label: `${index + 1} / ${document.sections.length} · ${item.title}` }))} />
        <Button size="icon" variant="ghost" className="[&_svg]:size-3.5 size-8" aria-label={copy.nextScene} disabled={busy || sceneIndex === document.sections.length - 1} onClick={() => chooseScene(sceneIndex + 1)}><ChevronRight aria-hidden="true" /></Button>
      </nav>
      <div className="mt-1.5 flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1"><h2 className="m-0 text-sm font-semibold wrap-anywhere">{scene.title}</h2>
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{sceneRange ? formatLoopTimestamp(sceneRange.startMs) + " – " + formatLoopTimestamp(sceneRange.endMs) : copy.noTime}</p></div>
        <Button size="icon" className="[&_svg]:size-3.5 size-8 shrink-0" variant="outline" aria-label={copy.playScene} disabled={busy || needsReload || !sourceUrl || !adapter.loop || !sceneRange} onClick={playScene}><Play aria-hidden="true" /></Button>
      </div>
    </header>

    <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" data-ui="lessonContent">
      {editing && draft ? <section aria-label={ui.adjust} className="grid gap-3">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{ui.adjust}</h3>
          <Button variant="ghost" size="icon" className="[&_svg]:size-3.5 size-8" aria-label={copy.cancelTiming} disabled={busy} onClick={closeTiming}><X aria-hidden="true" /></Button></div>
        <div><span className="text-[11px] text-muted-foreground">{target.type === "scene" ? copy.scene : copy.selected}</span><p className="mt-1 text-sm wrap-anywhere">{targetTitle}</p></div>
        <p className="text-xs text-muted-foreground">{ui.help}</p>
        <div className="rounded-lg bg-muted/50 p-3 text-center">
          <span className="text-[11px] text-muted-foreground">{ui.current}</span>
          <p className="mt-1 font-mono text-base tabular-nums">{currentMs === null ? "—" : formatLoopTimestamp(currentMs)}</p>
          <div className="mt-2 flex justify-center gap-3">
            <Button variant="outline" className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs" disabled={busy || needsReload || currentMs === null || !adapter.seek} onClick={() => jump(currentMs! - 1000)} aria-label={ui.back}>−1s</Button>
            <Button size="icon" className="[&_svg]:size-3.5 size-8" aria-label={playing ? ui.pause : ui.play} disabled={busy || needsReload || !adapter.play || !adapter.pause} onClick={togglePlayback}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
            <Button variant="outline" className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs" disabled={busy || needsReload || currentMs === null || !adapter.seek} onClick={() => jump(currentMs! + 1000)} aria-label={ui.forward}>+1s</Button>
          </div>
        </div>
        {(["startMs", "endMs"] as const).map(boundary => <fieldset key={boundary} className="grid min-w-0 gap-2">
          <legend className="mb-2 flex w-full items-center justify-between text-xs font-semibold">{boundary === "startMs" ? ui.start : ui.end}<span className="font-mono tabular-nums">{formatLoopTimestamp(draft[boundary])}</span></legend>
          <div className="grid grid-cols-4 gap-1">{[-500, -100, 100, 500].map(delta => <Button key={delta} variant="outline" className="h-8 min-h-8 px-1 text-xs" disabled={busy}
            aria-label={`${boundary === "startMs" ? ui.start : ui.end} ${delta > 0 ? "+" : ""}${delta / 1000}s`} onClick={() => adjustBoundary(boundary, delta)}>{delta > 0 ? "+" : "−"}{Math.abs(delta) / 1000}s</Button>)}</div>
          <Button variant="secondary" className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs" disabled={busy || needsReload || !adapter.loop} onClick={() => testBoundary(boundary)}><Play aria-hidden="true" />{boundary === "startMs" ? ui.testStart : ui.testEnd}</Button>
        </fieldset>)}
        <p className="text-xs leading-relaxed text-muted-foreground">{target.type === "sentence" ? ui.saveHint : ui.sceneHint}</p>
        {status && <p role="status" className="text-xs text-destructive">{status}</p>}
        <div className="flex justify-between gap-2"><Button variant="ghost" className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs" disabled={busy} onClick={() => {
          const original = target.type === "sentence" ? effectiveCueWindow(selectedCue, {}) : scenePlaybackWindow(scene.startMs, scene.endMs);
          if (original) { setDraft(original); setDraftReset(true); setStatus(""); }
        }}>{ui.reset}</Button><Button className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs" disabled={busy} onClick={() => saveTiming(draftReset ? null : draft)}>{copy.saveTiming}</Button></div>
      </section> : <>
        <p className="mb-3 text-xs leading-[1.6] text-muted-foreground">{scene.context}</p>
        <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold">{copy.dialogue}</h3>
          <Button size="sm" variant="ghost" className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs" aria-pressed={translationVisible} onClick={() => setTranslationVisible(value => !value)}>{translationVisible ? copy.hideTranslation : copy.translation}</Button></div>
        <div role="group" aria-label={copy.dialogue}>
          {lines.map((cue, index) => {
            const selected = selectedCue?.id === cue.id;
            const active = playing && playingCueId === cue.id;
            const translation = scene.translations.find(item => item.cueId === cue.id);
            return <Button key={cue.id} variant="ghost"
              className="grid h-auto min-h-8 w-full grid-cols-[24px_minmax(0,1fr)] items-start text-left whitespace-normal leading-relaxed"
              aria-pressed={selected} aria-current={active ? "true" : undefined} disabled={busy || needsReload} onClick={() => selectCue(cue.id)}>
              <span className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
              <span className="grid min-w-0 gap-2 wrap-anywhere"><span lang={targetLanguage}>{annotatedText(cue.originalText, scene.pronunciations?.find(item => item.cueId === cue.id)?.segments)}</span>
                {translationVisible && translation && <span className="text-xs font-normal text-muted-foreground">{translation.text}</span>}</span>
            </Button>;
          })}
        </div>
        <SceneFocusItems key={scene.id} scene={scene} targetLanguage={targetLanguage} copy={copy} annotatedText={annotatedText} />
      </>}
    </div>

    {sourceUrl && adapter.id !== "import" && adapter.loop ? <footer className="shrink-0 border-t border-border bg-card px-3 py-2" role="region" aria-label={copy.playback} data-ui="unifiedPlayer">
      <div className="flex min-w-0 items-center gap-2"><span className="text-[11px] text-muted-foreground">{playing ? ui.playing : ui.ready}</span>
        {loop && <span role="status" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary"><Repeat2 aria-hidden="true" className="size-3" />{ui.loopEnabled}</span>}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{target.type === "scene" ? sceneIndex + 1 + " / " + document.sections.length : selectedIndex + 1 + " / " + lines.length}</span></div>
      <strong className="mt-1 block truncate text-xs" title={targetTitle} lang={target.type === "sentence" ? targetLanguage : undefined}>{targetTitle}</strong>
      <div className="my-1 flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" className="[&_svg]:size-3.5 size-8" aria-label={previousLabel} disabled={busy || editing || (needsReload && target.type === "sentence") || previousDisabled}
          onClick={() => target.type === "scene" ? chooseScene(sceneIndex - 1) : selectCue(scene.cueIds[selectedIndex - 1])}><SkipBack aria-hidden="true" /></Button>
        <Button size="icon" className="[&_svg]:size-3.5 size-9 rounded-full" aria-label={playing ? ui.pause : ui.play} disabled={busy || !canPlay || !adapter.pause || (editing && !adapter.play)} onClick={togglePlayback}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
        <Button variant="ghost" size="icon" className="[&_svg]:size-3.5 size-8" aria-label={nextLabel} disabled={busy || editing || (needsReload && target.type === "sentence") || nextDisabled}
          onClick={() => target.type === "scene" ? chooseScene(sceneIndex + 1) : selectCue(scene.cueIds[selectedIndex + 1])}><SkipForward aria-hidden="true" /></Button>
      </div>
      {range && <PlaybackTimeline key={target.type === "sentence" ? target.sentenceId : target.sceneId}
        range={range} position={targetStarted ? currentMs ?? range.startMs : range.startMs}
        playing={playing && targetStarted} rate={playbackRate} label={ui.seek}
        disabled={busy || needsReload || editing || !adapter.seek} onSeek={jump} />}
      <div className="mt-0.5 flex items-center justify-center gap-3">
        <Toggle size="sm" pressed={loop} className="size-8 rounded-lg p-0 [&_svg]:size-3.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground" title={loop ? ui.loopEnabled : ui.loop} aria-label={ui.loop} disabled={busy || editing || !canPlay}
          onPressedChange={next => void command(async () => { if (range && playing) await startRange(range, targetStarted && currentMs !== null && currentMs >= range.startMs && currentMs < range.endMs ? currentMs : undefined, next); setLoop(next); })}><Repeat2 aria-hidden="true" /></Toggle>
        <SelectField className="h-8 min-h-8 w-20 px-2 text-xs" ariaLabel={copy.speed} value={String(playbackRate)} disabled={busy || needsReload || !adapter.setPlaybackRate} onValueChange={value => void command(async () => {
          if (sourceUrl && adapter.setPlaybackRate) { const rate = Number(value); await adapter.setPlaybackRate(sourceUrl, rate); setPlaybackRate(rate); }
        })} options={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => ({ value: String(rate), label: rate + "×" }))} />
        <Popover open={optionsOpen} onOpenChange={setOptionsOpen}><PopoverTrigger asChild><Button size="icon" variant="ghost" className="[&_svg]:size-3.5 size-8" aria-label={ui.options} disabled={busy || needsReload || editing}><MoreHorizontal aria-hidden="true" /></Button></PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-56 p-1">
            <Button variant="ghost" className="h-8 min-h-8 w-full justify-start px-2 text-xs" disabled={!range || busy} onClick={openTiming}>{ui.adjust}</Button>
            <Button variant="ghost" className="h-8 min-h-8 w-full justify-start px-2 text-xs" disabled={!hasOverride || busy} onClick={() => saveTiming(null)}>{ui.reset}</Button>
          </PopoverContent>
        </Popover>
      </div>
    </footer> : <p className="shrink-0 border-t border-border p-3 text-xs text-muted-foreground">{copy.noVideo}</p>}
  </div>;
}
