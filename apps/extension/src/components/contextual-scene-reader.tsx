import { getPreferencesStore } from "../lib/preferences-store";
import { useContentMotion } from "../hooks/use-content-motion";
import { IconTooltipContent } from "./icon-tooltip";
import { PlaybackTimeline } from "./playback-timeline";
import { readStudyProgress, recordSceneVisit, studyProgressKey } from "../lib/study-progress";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Play,
  Repeat2,
  WholeWord,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import {
  subtitlePronunciationSegments,
  type SubtitlePronunciationSegment,
  readerScene,
  type LearningDocument,
  type SubtitleCue,
  type ExpressionOccurrence,
} from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { contextualReaderMessages } from "../i18n/contextual-reader";
import { unifiedPlayerMessages } from "../i18n/unified-player";
import { pronunciationCopy } from "../i18n/pronunciation";
import { playbackTimingMessages } from "../i18n/playback-timing";
import { playingCueAt } from "../video/cue-follow";
import {
  adjustLoopBoundary,
  formatLoopTimestamp,
  isLoopWindow,
  type LoopWindow,
} from "../video/loop-window";
import {
  cuePlaybackWindow,
  effectiveCueWindow,
  playbackCueMap,
  scenePlaybackWindow,
} from "../video/reader-playback";
import { openOrFocusVideoTab } from "../video/tab";
import { useVideoReaderHealth } from "../hooks/use-video-reader-health";
import type { VideoAdapter } from "../video/types";
import { SentenceDialogue } from "./sentence-dialogue";
import { SelectionSpeech } from "./selection-speech";
import { SpeechStatus, useSystemSpeech } from "./system-speech";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import { SelectField } from "./ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  defaultPronunciationMode,
  displayReading,
  japaneseKanjiAnnotations,
  pronunciationModes,
  romanAnnotations,
  type PronunciationMode,
} from "./pronunciation";

type ContextualDocument = LearningDocument;
type Repeat = "2" | "3" | "5" | "infinite";
type Props = {
  fullscreen?: boolean;
  onBack?: () => void;
  backLabel?: string;
  menuActions?: { label: string; onSelect: () => void }[];
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

type PlaybackTarget =
  | { type: "scene"; sceneId: string }
  | {
      type: "sentence";
      sceneId: string;
      sentenceId: string;
      sentenceCueIds?: string[];
      occurrenceCueIds?: string[];
    };

/** Scene navigation and one player frame the independently scrolling lesson. */
export function ContextualSceneReader({
  fullscreen = false,
  onBack,
  backLabel,
  menuActions = [],
  document,
  adapter,
  locale,
  playbackRate,
  setPlaybackRate,
  onError,
  onNotice,
  onSaveRange,
  onSaveSceneRange,
}: Props) {
  const copy = contextualReaderMessages[locale];
  const ui = unifiedPlayerMessages[locale];
  const timing = playbackTimingMessages[locale];
  const targetLanguage = document.profile.targetLanguage;
  const speech = useSystemSpeech();
  const phonetics = pronunciationCopy(locale, targetLanguage);
  const preferencesStore = () => getPreferencesStore(chrome.storage.local, locale);
  const [pronunciationMode, setPronunciationMode] = useState<PronunciationMode>(() =>
    defaultPronunciationMode(targetLanguage),
  );
  const cues = useMemo(() => new Map(document.cues.map(cue => [cue.id, cue])), [document.cues]);
  const defaultPlaybackCues = useMemo(
    () => playbackCueMap(document.cues, document.source.platform, {}),
    [document.cues, document.source.platform],
  );
  const playbackCues = useMemo(
    () =>
      new Map(
        [...defaultPlaybackCues.values()].map(cue => [
          cue.id,
          { ...cue, ...document.playbackOverrides?.[cue.id] },
        ]),
      ),
    [defaultPlaybackCues, document.playbackOverrides],
  );
  const [sceneIndex, setSceneIndex] = useState(0);
  const scene = document.sections[sceneIndex] ?? document.sections[0];
  useEffect(() => {
    const scope = document.id + ":" + scene.id;
    return () => {
      void speech?.controller.stop(scope).catch(() => {});
    };
  }, [speech?.controller, document.id, scene.id]);
  const lines = scene.cueIds.map(id => cues.get(id)).filter((cue): cue is SubtitleCue => !!cue);
  const [target, setTarget] = useState<PlaybackTarget>({ type: "scene", sceneId: scene.id });
  const [translationVisible, setTranslationVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const speechPreparation = useRef(Promise.resolve());
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
  const sceneMotionRef = useRef<HTMLDivElement>(null);
  useContentMotion(sceneMotionRef, scene?.id ?? "empty", {
    duration: 160,
    entryDuration: 180,
    enter: true,
  });
  const managedRef = useRef(false);
  const mountedRef = useRef(true);
  const sourceUrl = document.source.url;
  const { needsReload, recheck } = useVideoReaderHealth(adapter, sourceUrl, false);
  const selectedCue = target.type === "sentence" ? cues.get(target.sentenceId) : undefined;
  const selectedIndex = selectedCue ? scene.cueIds.indexOf(selectedCue.id) : -1;
  const selectedEndIndex =
    target.type === "sentence" && target.sentenceCueIds
      ? scene.cueIds.indexOf(target.sentenceCueIds.at(-1)!)
      : selectedIndex;
  const resetSentenceRange =
    target.type === "sentence"
      ? target.sentenceCueIds
        ? cuePlaybackWindow(
            target.sentenceCueIds,
            new Map(
              [...playbackCues].map(([id, cue]) => [
                id,
                id === target.sentenceId ? defaultPlaybackCues.get(id)! : cue,
              ]),
            ),
          )
        : effectiveCueWindow(defaultPlaybackCues.get(target.sentenceId), {})
      : null;
  const occurrenceRange =
    target.type === "sentence" && target.occurrenceCueIds
      ? cuePlaybackWindow(target.occurrenceCueIds, playbackCues)
      : null;
  const defaultSceneRange =
    (document.source.platform === "youtube"
      ? cuePlaybackWindow(scene.cueIds, playbackCues)
      : null) ?? scenePlaybackWindow(scene.startMs, scene.endMs);
  const sceneRange = document.scenePlaybackOverrides?.[scene.id] ?? defaultSceneRange;
  const range =
    target.type === "sentence"
      ? (occurrenceRange ??
        document.playbackOverrides?.[target.sentenceId] ??
        (target.sentenceCueIds
          ? cuePlaybackWindow(target.sentenceCueIds, playbackCues)
          : effectiveCueWindow(playbackCues.get(target.sentenceId), {})))
      : sceneRange;
  const targetTitle =
    target.type === "sentence" && (target.occurrenceCueIds || target.sentenceCueIds)
      ? (target.occurrenceCueIds ?? target.sentenceCueIds)!
          .map(id => cues.get(id)?.originalText)
          .join(" ")
      : (selectedCue?.originalText ?? scene.title);
  const canPlay = !needsReload && !!sourceUrl && !!adapter.loop && !!range;
  const progressKey = studyProgressKey(document.id);
  const studyProgressRef = useRef<unknown>(null);
  const hasDisplayableReading = (
    text: string,
    segments?: SubtitlePronunciationSegment[],
  ): boolean =>
    !!segments?.length &&
    segments.map(item => item.text).join("") === text &&
    (pronunciationMode === "native" && targetLanguage === "ja"
      ? segments.some(
          item =>
            !!item.reading &&
            (item.rubyPosition !== undefined ||
              japaneseKanjiAnnotations(item.text, item.reading).some(piece => !!piece.reading)),
        )
      : pronunciationMode === "roman"
        ? !!romanAnnotations(targetLanguage, text, segments)
        : segments.some(item => !!displayReading(targetLanguage, pronunciationMode, item.reading)));
  const sceneView = useMemo(() => readerScene(document, scene), [document, scene]);
  const hasSceneReading =
    lines.some(cue => {
      const segments = subtitlePronunciationSegments(
        cue,
        scene.pronunciations?.find(item => item.cueId === cue.id)?.segments,
      );
      return hasDisplayableReading(cue.originalText, segments);
    }) ||
    sceneView.focusItems.some(item =>
      item.examples.some(example =>
        example.dialogue.some(line => hasDisplayableReading(line.text, line.pronunciation)),
      ),
    );

  useEffect(() => {
    let live = true;
    setPronunciationMode(defaultPronunciationMode(targetLanguage));
    void preferencesStore()
      .load()
      .then(saved => {
        const candidate = saved.pronunciationModes?.[targetLanguage] as PronunciationMode;
        if (live && pronunciationModes(targetLanguage).includes(candidate))
          setPronunciationMode(candidate);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [targetLanguage]);

  function choosePronunciation(mode: PronunciationMode): void {
    setPronunciationMode(mode);
    void preferencesStore()
      .savePronunciation(targetLanguage, mode)
      .catch(() => undefined);
  }

  function annotatedText(text: string, segments?: SubtitlePronunciationSegment[]): React.ReactNode {
    if (
      pronunciationMode === "off" ||
      !segments?.length ||
      segments.map(item => item.text).join("") !== text
    )
      return text;
    if (pronunciationMode === "roman") {
      const parts = romanAnnotations(targetLanguage, text, segments);
      return parts
        ? parts.map((part, index) =>
            part.reading ? (
              <span key={index}>
                {part.text}
                <span
                  lang={
                    targetLanguage === "ja"
                      ? "ja-Latn"
                      : targetLanguage === "ko"
                        ? "ko-Latn"
                        : "zh-Latn"
                  }
                  className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]"
                >
                  （{part.reading}）
                </span>
              </span>
            ) : (
              <React.Fragment key={index}>{part.text}</React.Fragment>
            ),
          )
        : text;
    }
    if (pronunciationMode === "native" && targetLanguage === "ja")
      return segments.flatMap((item, index) =>
        item.reading && item.rubyPosition !== undefined
          ? [
              <ruby
                key={index}
                style={{ rubyPosition: item.rubyPosition }}
                className="leading-[2.2]"
              >
                {item.text}
                <rp>(</rp>
                <rt className="text-[8px] font-normal text-muted-foreground">{item.reading}</rt>
                <rp>)</rp>
              </ruby>,
            ]
          : item.reading
            ? japaneseKanjiAnnotations(item.text, item.reading).map((piece, pieceIndex) =>
                piece.reading ? (
                  Array.from(piece.reading).length > Array.from(piece.text).length * 2 + 1 ? (
                    <span key={`${index}-${pieceIndex}`}>
                      {piece.text}
                      <span className="text-[11px] text-muted-foreground">（{piece.reading}）</span>
                    </span>
                  ) : (
                    <ruby
                      key={`${index}-${pieceIndex}`}
                      className="ruby-[position:over] leading-[2.2]"
                    >
                      {piece.text}
                      <rp>(</rp>
                      <rt className="text-[8px] font-normal text-muted-foreground">
                        {piece.reading}
                      </rt>
                      <rp>)</rp>
                    </ruby>
                  )
                ) : (
                  <React.Fragment key={`${index}-${pieceIndex}`}>{piece.text}</React.Fragment>
                ),
              )
            : [<React.Fragment key={index}>{item.text}</React.Fragment>],
      );
    return segments.map((item, index) => {
      const reading = displayReading(targetLanguage, pronunciationMode, item.reading);
      if (reading && Array.from(item.text).length > 14)
        return (
          <span key={index} className="inline-block max-w-full min-w-0 align-top">
            <span className="block wrap-anywhere">{item.text}</span>
            <span className="block text-[10px] leading-[1.6] text-muted-foreground wrap-anywhere">
              {reading}
            </span>
          </span>
        );
      return reading ? (
        <ruby key={index} className="ruby-[position:over] leading-[2.2]">
          {item.text}
          <rp>(</rp>
          <rt className="text-[10px] font-normal text-muted-foreground">{reading}</rt>
          <rp>)</rp>
        </ruby>
      ) : (
        <React.Fragment key={index}>{item.text}</React.Fragment>
      );
    });
  }

  useEffect(() => {
    let live = true;
    void chrome.storage.local
      .get(progressKey)
      .then(saved => {
        const restored = readStudyProgress(
          saved[progressKey],
          document.sections.map(scene => scene.id),
        );
        studyProgressRef.current = restored;
        const id = restored.sceneId;
        const index = document.sections.findIndex(item => item.id === id);
        if (live && index >= 0 && id) {
          setSceneIndex(index);
          setTarget({ type: "scene", sceneId: id });
        }
        if (live && document.sections[0]) {
          studyProgressRef.current = recordSceneVisit(
            restored,
            id ?? document.sections[0].id,
            document.sections.map(scene => scene.id),
          );
          void chrome.storage.local
            .set({ [progressKey]: studyProgressRef.current })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [document.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (managedRef.current && sourceUrl && adapter.stopLoop)
        void adapter.stopLoop(sourceUrl).catch(() => undefined);
    };
  }, [adapter, sourceUrl]);

  useEffect(() => {
    if (!sourceUrl || !adapter.status) return;
    let live = true;
    let inFlight = false;
    let lastCueId: string | null = null;
    let previousMs: number | null = null;
    let previouslyPlaying = false;
    const poll = async () => {
      if (inFlight || busyRef.current) return;
      inFlight = true;
      try {
        const speechAtStart = speech?.controller.snapshot().active;
        const state = await adapter.status!(sourceUrl);
        if (!live || busyRef.current) return;
        if (
          state.playing === true &&
          speechAtStart?.phase === "speaking" &&
          speech?.controller.snapshot().active?.id === speechAtStart.id
        )
          void speech.controller.stop().catch(() => {});
        const position =
          typeof state.currentMs === "number" && Number.isFinite(state.currentMs)
            ? state.currentMs
            : null;
        setCurrentMs(position);
        setPlaying((editing || targetStarted) && state.playing === true);
        const active =
          target.type === "sentence" &&
          (!target.occurrenceCueIds || document.source.platform !== "youtube") &&
          !target.sentenceCueIds &&
          selectedCue &&
          range
            ? { cueId: selectedCue.id, ...range }
            : null;
        const cueId = targetStarted
          ? playingCueAt(scene.cueIds, playbackCues, position, active)
          : null;
        if (cueId) lastCueId = cueId;
        else if (
          !targetStarted ||
          position === null ||
          (state.playing !== true && !previouslyPlaying && position !== previousMs)
        )
          lastCueId = null;
        // A range can pause just after its final cue. Keep that line until playback
        // resumes or the paused video is moved to a different position.
        setPlayingCueId(cueId ?? (state.playing === false ? lastCueId : null));
        previousMs = position;
        previouslyPlaying = state.playing === true;
      } catch {
        if (live) {
          lastCueId = null;
          previousMs = null;
          previouslyPlaying = false;
          setCurrentMs(null);
          setPlaying(false);
          setPlayingCueId(null);
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 300);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [
    sourceUrl,
    adapter,
    scene,
    target,
    selectedCue,
    range?.startMs,
    range?.endMs,
    playbackCues,
    document.source.platform,
    editing,
    targetStarted,
  ]);

  async function command(action: () => Promise<void>, showBusy = true): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    if (showBusy) setBusy(true);
    setStatus("");
    try {
      await speech?.controller.stop();
      await speechPreparation.current.catch(() => {});
      await action();
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      busyRef.current = false;
      if (showBusy && mountedRef.current) setBusy(false);
    }
  }

  async function stopManaged(): Promise<void> {
    if (sourceUrl && adapter.stopLoop) await adapter.stopLoop(sourceUrl);
    managedRef.current = false;
  }
  function pauseForSpeech(isCurrent: () => boolean): Promise<void> {
    const preparation = speechPreparation.current
      .catch(() => {})
      .then(async () => {
        if (!isCurrent()) return;
        if (busyRef.current) throw new Error("A video command is still running.");
        if (managedRef.current) await stopManaged();
        if (!isCurrent()) return;
        if (sourceUrl && adapter.pause && !needsReload) {
          let videoPlaying = playing;
          if (adapter.status) {
            try {
              videoPlaying = (await adapter.status(sourceUrl)).playing === true;
            } catch {
              videoPlaying = playing;
            }
          }
          if (!isCurrent()) return;
          if (videoPlaying) await adapter.pause(sourceUrl);
        }
        if (!isCurrent()) return;
        setPlaying(false);
        setTargetStarted(false);
        setPlayingCueId(null);
      });
    speechPreparation.current = preparation;
    return preparation;
  }
  useEffect(
    () => speech?.controller.setBeforeSpeak(pauseForSpeech),
    [speech?.controller, sourceUrl, adapter, needsReload, playing],
  );

  async function startRange(
    next: LoopWindow,
    resumeMs?: number,
    repeat = loop,
    trackTarget = true,
  ): Promise<void> {
    if (!sourceUrl || !adapter.loop) return;
    await stopManaged();
    if (adapter.setPlaybackRate) await adapter.setPlaybackRate(sourceUrl, playbackRate);
    await adapter.loop(sourceUrl, {
      ...next,
      repeats: repeat ? "infinite" : 1,
      delaySeconds: 0,
      resumeMs,
    });
    if (trackTarget) setTargetStarted(true);
    managedRef.current = true;
    setPlaying(true);
    setCurrentMs(resumeMs ?? next.startMs);
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
      setSceneIndex(index);
      setTarget({ type: "scene", sceneId: next.id });
      setEditing(false);
      setDraft(null);
      setPlaying(false);
      setPlayingCueId(null);
      setTranslationVisible(false);
      contentRef.current?.scrollTo({ top: 0 });
      studyProgressRef.current = recordSceneVisit(
        studyProgressRef.current,
        next.id,
        document.sections.map(scene => scene.id),
      );
      void chrome.storage.local
        .set({ [progressKey]: studyProgressRef.current })
        .catch(() => undefined);
    });
  }

  function playScene(): void {
    if (!sceneRange) return;
    void command(async () => {
      setEditing(false);
      setTarget({ type: "scene", sceneId: scene.id });
      await startRange(sceneRange);
    });
  }

  function selectCue(id: string): void {
    const analysis =
      document.source.platform === "youtube"
        ? sceneView.analyses.find(analysis => analysis.sourceCueIds.includes(id))
        : undefined;
    const group = analysis?.sourceCueIds;
    const sentenceCueIds =
      group && group.length > 1 && !(document.playbackOverrides?.[id] && id !== group[0])
        ? group
        : undefined;
    const sentenceId = sentenceCueIds?.[0] ?? id;
    const next =
      document.playbackOverrides?.[sentenceId] ??
      (sentenceCueIds
        ? cuePlaybackWindow(sentenceCueIds, playbackCues)
        : effectiveCueWindow(playbackCues.get(id), {}));
    void command(async () => {
      setEditing(false);
      setTargetStarted(false);
      setTarget({ type: "sentence", sceneId: scene.id, sentenceId, sentenceCueIds });
      if (next && sourceUrl && adapter.loop) await startRange(next);
      else {
        await stopManaged();
        onNotice(copy.noTime);
      }
    });
  }

  function playOccurrence(occurrence: ExpressionOccurrence): void {
    const next = cuePlaybackWindow(occurrence.cueIds, playbackCues);
    if (!next || !sourceUrl || needsReload) return;
    void command(async () => {
      setEditing(false);
      setTargetStarted(false);
      setTarget({
        type: "sentence",
        sceneId: scene.id,
        sentenceId: occurrence.cueIds[0],
        occurrenceCueIds: occurrence.cueIds,
      });
      await startRange(next);
    });
  }

  function togglePlayback(): void {
    if (!sourceUrl) return;
    // The command lock prevents overlapping requests without dimming the reader.
    void command(async () => {
      if (playing && adapter.pause) {
        await stopManaged();
        await adapter.pause(sourceUrl);
        setPlaying(false);
        // Resume from the stopped video position rather than the last 300ms poll.
        if (adapter.status) {
          const paused = await adapter.status(sourceUrl).catch(() => null);
          if (typeof paused?.currentMs === "number" && Number.isFinite(paused.currentMs))
            setCurrentMs(paused.currentMs);
        }
      } else if (editing && adapter.play) {
        await stopManaged();
        await adapter.play(sourceUrl);
        setPlaying(true);
      } else if (range)
        await startRange(
          range,
          targetStarted &&
            currentMs !== null &&
            currentMs >= range.startMs &&
            currentMs < range.endMs - 100
            ? currentMs
            : undefined,
        );
    }, false);
  }

  function jump(position: number): void {
    if (!sourceUrl || !adapter.seek) return;
    void command(async () => {
      const next = Math.max(0, Math.round(position));
      if (editing) {
        await stopManaged();
        await adapter.seek!(sourceUrl, next);
        if (!playing && adapter.pause) await adapter.pause(sourceUrl);
        setCurrentMs(next);
      } else if (range)
        await startRange(range, Math.min(range.endMs - 1, Math.max(range.startMs, next)));
    });
  }

  function openTiming(): void {
    if (!range || (target.type === "sentence" && target.occurrenceCueIds)) return;
    void command(async () => {
      await stopManaged();
      if (sourceUrl && adapter.pause) await adapter.pause(sourceUrl);
      if (sourceUrl && adapter.status) {
        const state = await adapter.status(sourceUrl);
        setCurrentMs(
          typeof state.currentMs === "number" && Number.isFinite(state.currentMs)
            ? state.currentMs
            : null,
        );
      }
      setPlaying(false);
      setLoop(false);
      setDraft({ ...range });
      setDraftReset(false);
      setEditing(true);
      setOptionsOpen(false);
    });
  }

  function markBoundary(boundary: "start" | "end"): void {
    if (!draft || !sourceUrl || !adapter.pause || !adapter.status) return;
    void command(async () => {
      await stopManaged();
      await adapter.pause!(sourceUrl);
      setPlaying(false);
      // Capture the stopped video clock, not the last polling sample.
      const state = await adapter.status!(sourceUrl);
      if (typeof state.currentMs !== "number" || !Number.isFinite(state.currentMs)) {
        setCurrentMs(null);
        setStatus(timing.positionUnavailable);
        return;
      }
      setCurrentMs(state.currentMs);
      const next = adjustLoopBoundary(draft, boundary, state.currentMs);
      if (!next) {
        setStatus(ui.invalidRange);
        return;
      }
      setDraft(next);
      setDraftReset(false);
    });
  }

  function previewTiming(): void {
    if (!draft) return;
    void command(() => startRange(draft, undefined, false, false));
  }

  function nudgeTiming(boundary: "startMs" | "endMs", delta: number): void {
    if (!draft || busyRef.current) return;
    const next = { ...draft, [boundary]: Math.max(0, draft[boundary] + delta) };
    if (!isLoopWindow(next)) {
      setStatus(ui.invalidRange);
      return;
    }
    setDraft(next);
    setDraftReset(false);
    setStatus("");
  }

  function previewBoundary(boundary: "startMs" | "endMs"): void {
    if (!draft) return;
    const point = draft[boundary];
    void command(() =>
      startRange(
        { startMs: Math.max(0, point - 1000), endMs: point + 1000 },
        undefined,
        false,
        false,
      ),
    );
  }

  function closeTiming(): void {
    void command(async () => {
      await stopManaged();
      if (sourceUrl && adapter.pause) await adapter.pause(sourceUrl);
      setPlaying(false);
      setEditing(false);
      setDraft(null);
    });
  }

  function saveTiming(next: LoopWindow | null): void {
    void command(async () => {
      await stopManaged();
      if (sourceUrl && adapter.pause) await adapter.pause(sourceUrl);
      if (target.type === "sentence") await onSaveRange(target.sentenceId, next);
      else await onSaveSceneRange(target.sceneId, next);
      setEditing(false);
      setDraft(null);
      setOptionsOpen(false);
      setPlaying(false);
      onNotice(next ? timing.loopRangeSaved : timing.loopRangeReset);
    });
  }

  const previousDisabled = target.type === "scene" ? sceneIndex === 0 : selectedIndex <= 0;
  const nextDisabled =
    target.type === "scene"
      ? sceneIndex === document.sections.length - 1
      : selectedEndIndex < 0 || selectedEndIndex >= scene.cueIds.length - 1;
  const previousLabel = target.type === "scene" ? copy.previousScene : copy.previousCue;
  const nextLabel = target.type === "scene" ? copy.nextScene : copy.nextCue;
  const hasOverride =
    target.type === "scene"
      ? !!document.scenePlaybackOverrides?.[scene.id]
      : !!document.playbackOverrides?.[target.sentenceId];

  function playerOptions(timingControls = true): React.ReactNode {
    return (
      <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="[&_svg]:size-3.5 size-8"
            id="reader-options"
            aria-label={ui.options}
            disabled={busy || editing}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-56 p-1">
          {timingControls && (
            <>
              <Button
                variant="ghost"
                className="h-8 min-h-8 w-full justify-start px-2 text-xs"
                disabled={
                  !range ||
                  busy ||
                  needsReload ||
                  !adapter.status ||
                  !adapter.pause ||
                  (target.type === "sentence" && !!target.occurrenceCueIds)
                }
                onClick={openTiming}
              >
                {ui.adjust}
              </Button>
              <Button
                variant="ghost"
                className="h-8 min-h-8 w-full justify-start px-2 text-xs"
                disabled={
                  !hasOverride ||
                  busy ||
                  needsReload ||
                  (target.type === "sentence" && !!target.occurrenceCueIds)
                }
                onClick={() => saveTiming(null)}
              >
                {ui.reset}
              </Button>
            </>
          )}
          {timingControls && menuActions.length > 0 && (
            <div className="my-1 border-t border-border" />
          )}
          {menuActions.map(action => (
            <Button
              key={action.label}
              variant="ghost"
              className="h-8 min-h-8 w-full justify-start px-2 text-xs"
              onClick={() => {
                setOptionsOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <div
      className={
        "@container/reader flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card " +
        (fullscreen ? "" : "rounded-t-xl border border-border")
      }
      data-ui="unifiedReader"
    >
      <header data-ui="reader-header" className="shrink-0 border-b border-border px-3 py-2">
        <div className="mx-auto flex w-full min-w-0 max-w-[720px] items-center gap-2">
          {onBack && (
            <Button
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 [&_svg]:size-3.5"
              aria-label={backLabel}
              title={backLabel}
              onClick={onBack}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11px] text-muted-foreground">
              {targetLanguage.toUpperCase()} · {document.profile.level}
            </p>
            <strong className="block truncate text-xs" title={document.source.title}>
              {document.source.title}
            </strong>
          </div>
          <Popover
            open={pronunciationOpen}
            onOpenChange={open => {
              setPronunciationOpen(open);
              setPronunciationTooltipVisible(false);
            }}
          >
            <span
              className="relative inline-flex shrink-0"
              onMouseEnter={() => {
                if (!pronunciationOpen) setPronunciationTooltipVisible(true);
              }}
              onMouseLeave={() => setPronunciationTooltipVisible(false)}
              onFocus={() => {
                if (!pronunciationOpen) setPronunciationTooltipVisible(true);
              }}
              onBlur={() => setPronunciationTooltipVisible(false)}
              onKeyDown={event => {
                if (event.key === "Escape") setPronunciationTooltipVisible(false);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="[&_svg]:size-3.5 size-8"
                  aria-label={phonetics.title}
                  aria-describedby={
                    pronunciationTooltipVisible ? pronunciationTooltipId : undefined
                  }
                >
                  <WholeWord aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              {pronunciationTooltipVisible && (
                <IconTooltipContent id={pronunciationTooltipId}>
                  {phonetics.title}
                </IconTooltipContent>
              )}
            </span>
            <PopoverContent align="end" className="w-64 max-w-[calc(100vw-24px)] p-3">
              <p className="mb-2 text-xs font-semibold">{phonetics.title}</p>
              <ToggleGroup
                type="single"
                variant="default"
                size="sm"
                value={pronunciationMode}
                className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1"
                aria-label={phonetics.title}
                onValueChange={mode => {
                  if (mode) choosePronunciation(mode as PronunciationMode);
                }}
              >
                {pronunciationModes(targetLanguage).map(mode => (
                  <ToggleGroupItem
                    key={mode}
                    value={mode}
                    className="h-7 min-w-0 rounded-md px-2 text-xs font-medium data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs"
                  >
                    {phonetics.option(mode)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {pronunciationMode !== "off" && !hasSceneReading && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground" role="status">
                  {phonetics.unavailable}
                </p>
              )}
            </PopoverContent>
          </Popover>
          {sourceUrl && adapter.id !== "import" && (
            <span
              className="relative inline-flex shrink-0"
              onMouseEnter={() => setVideoTooltipVisible(true)}
              onMouseLeave={() => setVideoTooltipVisible(false)}
              onFocus={() => setVideoTooltipVisible(true)}
              onBlur={() => setVideoTooltipVisible(false)}
              onKeyDown={event => {
                if (event.key === "Escape") setVideoTooltipVisible(false);
              }}
            >
              <Button
                size="icon"
                variant="ghost"
                className="[&_svg]:size-3.5 size-8"
                aria-label={copy.video}
                aria-describedby={videoTooltipVisible ? videoTooltipId : undefined}
                disabled={busy}
                onClick={() =>
                  void command(async () => {
                    setVideoTooltipVisible(false);
                    await openOrFocusVideoTab(adapter, sourceUrl);
                    recheck();
                  })
                }
              >
                <ExternalLink aria-hidden="true" />
              </Button>
              {videoTooltipVisible && (
                <IconTooltipContent id={videoTooltipId}>{copy.video}</IconTooltipContent>
              )}
            </span>
          )}
        </div>
        <nav
          className="mx-auto mt-2 grid w-full max-w-[720px] grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-2"
          aria-label={copy.chooseScene}
        >
          <Button
            size="icon"
            variant="ghost"
            className="[&_svg]:size-3.5 size-8"
            aria-label={copy.previousScene}
            disabled={busy || editing || sceneIndex === 0}
            onClick={() => chooseScene(sceneIndex - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <SelectField
            className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs"
            id="contextual-scene-picker"
            ariaLabel={copy.chooseScene}
            value={String(sceneIndex)}
            disabled={busy || editing}
            onValueChange={value => chooseScene(Number(value))}
            options={document.sections.map((item, index) => ({
              value: String(index),
              label: `${index + 1} / ${document.sections.length} · ${item.title}`,
            }))}
          />
          <Button
            size="icon"
            variant="ghost"
            className="[&_svg]:size-3.5 size-8"
            aria-label={copy.nextScene}
            disabled={busy || editing || sceneIndex === document.sections.length - 1}
            onClick={() => chooseScene(sceneIndex + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      </header>

      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 @min-[774px]/reader:[scrollbar-gutter:stable_both-edges]"
        data-ui="lessonContent"
      >
        <div ref={sceneMotionRef} className="mx-auto w-full min-w-0 max-w-[720px]">
          {editing && draft ? (
            <section aria-label={ui.adjust} className="grid gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{ui.adjust}</h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="[&_svg]:size-3.5 size-8"
                  aria-label={copy.cancelTiming}
                  disabled={busy}
                  onClick={closeTiming}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
              <p className="text-sm wrap-anywhere">{targetTitle}</p>
              <p className="text-xs text-muted-foreground">{ui.help}</p>
              <div className="rounded-lg bg-muted/50 p-2 text-center">
                <span className="text-[11px] text-muted-foreground">{ui.current}</span>
                <p className="mt-1 font-mono text-base tabular-nums">
                  {currentMs === null ? "—" : formatLoopTimestamp(currentMs)}
                </p>
                <div className="mt-2 flex justify-center gap-3">
                  <Button
                    variant="outline"
                    className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs"
                    disabled={busy || needsReload || currentMs === null || !adapter.seek}
                    onClick={() => jump(currentMs! - 1000)}
                    aria-label={ui.back}
                  >
                    −1s
                  </Button>
                  <Button
                    size="icon"
                    className="[&_svg]:size-3.5 size-8"
                    aria-label={playing ? ui.pause : ui.play}
                    disabled={busy || needsReload || !adapter.play || !adapter.pause}
                    onClick={togglePlayback}
                  >
                    {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="outline"
                    className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs"
                    disabled={busy || needsReload || currentMs === null || !adapter.seek}
                    onClick={() => jump(currentMs! + 1000)}
                    aria-label={ui.forward}
                  >
                    +1s
                  </Button>
                </div>
              </div>
              {(["startMs", "endMs"] as const).map(boundary => (
                <div
                  key={boundary}
                  role="group"
                  aria-label={boundary === "startMs" ? ui.start : ui.end}
                  className="grid min-w-0"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <p className="flex items-center gap-2">
                      <span className="font-semibold">
                        {boundary === "startMs" ? ui.start : ui.end}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatLoopTimestamp(draft[boundary])}
                      </span>
                    </p>
                    <Button
                      variant="ghost"
                      className="[&_svg]:size-3.5 h-8 min-h-8 shrink-0 px-2 text-xs"
                      disabled={busy || needsReload || !adapter.loop}
                      onClick={() => previewBoundary(boundary)}
                    >
                      <Play aria-hidden="true" />
                      {boundary === "startMs" ? ui.previewStart : ui.previewEnd}
                    </Button>
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
                    {[-100, 100].map(delta => (
                      <Button
                        key={delta}
                        variant="outline"
                        className="h-8 min-h-8 px-2 text-xs"
                        aria-label={`${boundary === "startMs" ? ui.start : ui.end} ${delta > 0 ? "+" : "-"}0.1s`}
                        disabled={busy}
                        onClick={() => nudgeTiming(boundary, delta)}
                      >
                        {delta > 0 ? "+" : "−"}0.1s
                      </Button>
                    ))}
                    <Button
                      variant="outline"
                      className="h-8 min-h-8 shrink-0 px-3 text-xs"
                      disabled={
                        busy ||
                        needsReload ||
                        currentMs === null ||
                        !adapter.pause ||
                        !adapter.status
                      }
                      onClick={() => markBoundary(boundary === "startMs" ? "start" : "end")}
                    >
                      {boundary === "startMs" ? ui.setStart : ui.setEnd}
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="secondary"
                className="[&_svg]:size-3.5 h-9 min-h-9 px-3 text-xs"
                disabled={busy || needsReload || !adapter.loop}
                onClick={previewTiming}
              >
                <Play aria-hidden="true" />
                {ui.preview}
              </Button>
              {status && (
                <p role="status" className="text-xs text-destructive">
                  {status}
                </p>
              )}
              <div className="flex justify-between gap-2">
                <Button
                  variant="ghost"
                  className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs"
                  disabled={busy}
                  onClick={() => {
                    const original =
                      target.type === "sentence" ? resetSentenceRange : defaultSceneRange;
                    if (original) {
                      setDraft(original);
                      setDraftReset(true);
                      setStatus("");
                    }
                  }}
                >
                  {ui.reset}
                </Button>
                <Button
                  className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs"
                  disabled={busy}
                  onClick={() => saveTiming(draftReset ? null : draft)}
                >
                  {copy.saveTiming}
                </Button>
              </div>
            </section>
          ) : (
            <>
              <p className="mb-3 text-ui-body text-muted-foreground">{sceneView.context}</p>
              <SpeechStatus locale={locale} language={document.profile.targetLanguage} />
              <SelectionSpeech
                key={document.id + ":" + scene.id}
                locale={locale}
                scope={document.id + ":" + scene.id + ":selection"}
                disabled={busy}
                beforeSpeak={pauseForSpeech}
              >
                <SentenceDialogue
                  key={document.id + ":" + scene.id}
                  toolbarPlaybackAction={
                    sourceUrl &&
                    adapter.id !== "import" &&
                    adapter.loop && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="[&_svg]:size-3.5 h-8 min-h-8 shrink-0 px-2 text-xs"
                        disabled={busy || needsReload || !sceneRange}
                        onClick={playScene}
                      >
                        <Play aria-hidden="true" />
                        {copy.playScene}
                      </Button>
                    )
                  }
                  toolbarActions={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="[&_svg]:size-3.5 h-8 min-h-8 px-2 text-xs text-muted-foreground"
                      aria-pressed={translationVisible}
                      onClick={() => setTranslationVisible(value => !value)}
                    >
                      {translationVisible ? copy.hideTranslation : copy.translation}
                    </Button>
                  }
                  document={document}
                  scene={scene}
                  locale={locale}
                  playingCueId={playingCueId}
                  selectedCueId={selectedCue?.id}
                  disabled={busy}
                  playbackDisabled={busy || needsReload || !sourceUrl || !adapter.loop}
                  translationVisible={translationVisible}
                  onPlayCue={selectCue}
                  onPlayOccurrence={playOccurrence}
                  beforeSpeak={pauseForSpeech}
                  annotatedText={annotatedText}
                />
              </SelectionSpeech>
            </>
          )}
        </div>
      </div>

      {editing ? null : sourceUrl && adapter.id !== "import" && adapter.loop ? (
        <footer
          className="shrink-0 border-t border-border bg-card px-3 py-2"
          role="region"
          aria-label={copy.playback}
          data-ui="unifiedPlayer"
        >
          <div
            className="@container mx-auto grid w-full min-w-0 max-w-[720px] gap-1"
            data-ui="player-body"
          >
            {loop && (
              <span role="status" className="sr-only">
                {ui.loopEnabled}
              </span>
            )}
            <div className="flex min-w-0 items-center gap-2" data-ui="player-target">
              <span className="shrink-0 text-xs font-medium" data-ui="player-scope">
                {target.type === "scene" ? copy.scene : copy.selected}
                {(target.type === "scene" || selectedIndex >= 0) && (
                  <>
                    {" "}
                    {target.type === "scene" ? sceneIndex + 1 : selectedIndex + 1}
                    {" / "}
                    {target.type === "scene" ? document.sections.length : lines.length}
                  </>
                )}
              </span>
              <span
                className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                title={targetTitle}
              >
                {target.type === "sentence" ? targetTitle : playing ? ui.playing : ui.ready}
              </span>
              {target.type === "sentence" && playing && (
                <span className="shrink-0 text-[11px] text-muted-foreground">{ui.playing}</span>
              )}
            </div>

            <div
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1"
              data-ui="player-controls"
            >
              <div className="flex min-w-0 items-center justify-end">
                <Toggle
                  size="sm"
                  pressed={loop}
                  className="size-8 rounded-lg p-0 [&_svg]:size-3.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground"
                  title={loop ? ui.loopEnabled : ui.loop}
                  aria-label={ui.loop}
                  disabled={busy || editing || !canPlay}
                  onPressedChange={next =>
                    void command(async () => {
                      if (range && playing)
                        await startRange(
                          range,
                          targetStarted &&
                            currentMs !== null &&
                            currentMs >= range.startMs &&
                            currentMs < range.endMs
                            ? currentMs
                            : undefined,
                          next,
                        );
                      setLoop(next);
                    })
                  }
                >
                  <Repeat2 aria-hidden="true" />
                </Toggle>
              </div>
              <div className="flex items-center @min-[360px]:gap-2" data-ui="player-transport">
                <Button
                  variant="ghost"
                  size="icon"
                  className="[&_svg]:size-3.5 size-8"
                  aria-label={previousLabel}
                  disabled={
                    busy ||
                    editing ||
                    (needsReload && target.type === "sentence") ||
                    previousDisabled
                  }
                  onClick={() =>
                    target.type === "scene"
                      ? chooseScene(sceneIndex - 1)
                      : selectCue(scene.cueIds[selectedIndex - 1])
                  }
                >
                  <SkipBack aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  className="[&_svg]:size-3.5 size-9 rounded-full"
                  title={target.type === "scene" ? copy.playScene : copy.playCue}
                  aria-label={playing ? ui.pause : ui.play}
                  disabled={busy || !canPlay || !adapter.pause || (editing && !adapter.play)}
                  onClick={togglePlayback}
                >
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="[&_svg]:size-3.5 size-8"
                  aria-label={nextLabel}
                  disabled={
                    busy || editing || (needsReload && target.type === "sentence") || nextDisabled
                  }
                  onClick={() =>
                    target.type === "scene"
                      ? chooseScene(sceneIndex + 1)
                      : selectCue(scene.cueIds[selectedEndIndex + 1])
                  }
                >
                  <SkipForward aria-hidden="true" />
                </Button>
              </div>
              <div
                className="flex min-w-0 items-center justify-end gap-1"
                data-ui="player-utilities"
              >
                <SelectField
                  className="h-8 min-h-8 w-14 gap-1 px-1 text-[11px] [&_svg]:size-2.5 @min-[360px]:w-20 @min-[360px]:px-2 @min-[360px]:text-xs @min-[360px]:[&_svg]:size-3.5"
                  ariaLabel={copy.speed}
                  value={String(playbackRate)}
                  disabled={busy || needsReload || !adapter.setPlaybackRate}
                  onValueChange={value =>
                    void command(async () => {
                      if (sourceUrl && adapter.setPlaybackRate) {
                        const rate = Number(value);
                        await adapter.setPlaybackRate(sourceUrl, rate);
                        setPlaybackRate(rate);
                      }
                    })
                  }
                  options={[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => ({
                    value: String(rate),
                    label: rate + "×",
                  }))}
                />
                {playerOptions()}
              </div>
            </div>
            {range && (
              <PlaybackTimeline
                key={target.type === "sentence" ? target.sentenceId : target.sceneId}
                range={range}
                position={targetStarted ? (currentMs ?? range.startMs) : range.startMs}
                playing={playing && targetStarted}
                rate={playbackRate}
                label={ui.seek}
                disabled={busy || needsReload || editing || !adapter.seek}
                onSeek={jump}
              />
            )}
          </div>
        </footer>
      ) : (
        <footer className="shrink-0 border-t border-border px-3 py-2">
          <div className="mx-auto flex w-full min-w-0 max-w-[720px] items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{copy.noVideo}</p>
            {menuActions.length > 0 && playerOptions(false)}
          </div>
        </footer>
      )}
    </div>
  );
}
