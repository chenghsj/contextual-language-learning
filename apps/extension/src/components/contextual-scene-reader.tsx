import { SceneFavoriteButton } from "./scene-favorite-button";
import { favoritesCopy } from "../i18n/favorites";
import { learningLevelLabel } from "../i18n/learning-settings";
import type { PreferencesStorage } from "../lib/preferences-store";
import { getPreferencesStore } from "../lib/preferences-store";
import { useContentMotion } from "../hooks/use-content-motion";
import { IconTooltipContent } from "./icon-tooltip";
import {
  TimingBoundaryField,
  TimingPositionControl,
  TimingRangeTimeline,
  TimingTimeInput,
} from "./timing-range-controls";
import { timingControlsCopy } from "../i18n/timing-controls";
import { subtitleEditorCopy } from "../i18n/subtitle-editor";
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
} from "lucide-react";
import {
  subtitlePronunciationSegments,
  type SubtitlePronunciationSegment,
  readerScene,
  type LearningDocument,
  type FavoriteReaderDocument,
  type FavoriteIdentity,
  type SubtitleCue,
  type ExpressionOccurrence,
} from "@contextual/core";
import type { UiLocale } from "../i18n/messages";
import { contextualReaderMessages } from "../i18n/contextual-reader";
import { unifiedPlayerMessages } from "../i18n/unified-player";
import { pronunciationCopy } from "../i18n/pronunciation";
import { playbackTimingMessages } from "../i18n/playback-timing";
import { playingCueAt } from "../video/cue-follow";
import { adjustLoopBoundary, isLoopWindow, type LoopWindow } from "../video/loop-window";
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

type Repeat = "2" | "3" | "5" | "infinite";
type Props = {
  readerStorage?: PreferencesStorage;
  favoriteControl?: (scene: LearningDocument["sections"][number]) => React.ReactNode;
  onOpenVideo?: () => Promise<void>;
  canEditTiming?: boolean;
  fullscreen?: boolean;
  onBack?: () => void;
  backLabel?: string;
  menuActions?: { label: string; onSelect: () => void }[];
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
} & (
  | {
      mode?: "lesson";
      document: LearningDocument;
      favoriteOrigin?: never;
      onSaveRange?: (cueId: string, range: LoopWindow | null) => Promise<void>;
      onSaveSceneRange?: (sceneId: string, range: LoopWindow | null) => Promise<void>;
    }
  | {
      mode: "favorite";
      document: FavoriteReaderDocument;
      favoriteOrigin: FavoriteIdentity;
      onSaveRange?: never;
      onSaveSceneRange?: never;
    }
);

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
  readerStorage,
  favoriteControl,
  onOpenVideo,
  canEditTiming = true,
  mode = "lesson",
  favoriteOrigin,
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
  const storage = () => readerStorage ?? chrome.storage.local;
  const preferencesStore = () => getPreferencesStore(storage(), locale);
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
  const [selectedSceneId, setSelectedSceneId] = useState(document.sections[0].id);
  const sceneIndex = Math.max(
    0,
    document.sections.findIndex(s => s.id === selectedSceneId),
  );
  const setSceneIndex = (index: number) =>
    setSelectedSceneId(document.sections[index]?.id ?? document.sections[0].id);
  const [progressReady, setProgressReady] = useState(false);
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
  const timingHeadingRef = useRef<HTMLHeadingElement>(null);
  const readingScroll = useRef(0);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) {
      contentRef.current?.scrollTo?.({ top: 0 });
      timingHeadingRef.current?.focus({ preventScroll: true });
    } else if (wasEditing.current) {
      contentRef.current?.scrollTo?.({ top: readingScroll.current });
      window.document.getElementById("reader-options")?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);
  const sceneMotionRef = useRef<HTMLDivElement>(null);
  useContentMotion(sceneMotionRef, scene?.id ?? "empty", {
    duration: 240,
    entryDuration: 240,
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
                  className="text-[10px] text-muted-foreground [overflow-wrap:anywhere]"
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
                      <span className="text-[10px] text-muted-foreground">（{piece.reading}）</span>
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
    void storage()
      .get([progressKey])
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
          void storage()
            .set({ [progressKey]: studyProgressRef.current })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setProgressReady(true);
      });
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
      void storage()
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
      readingScroll.current = contentRef.current?.scrollTop ?? 0;
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
    if (!onSaveRange || !onSaveSceneRange) return;
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
    timingControls =
      timingControls && mode !== "favorite" && canEditTiming && !!onSaveRange && !!onSaveSceneRange;
    if (!timingControls && menuActions.length === 0) return null;
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
      {editing ? (
        <header className="shrink-0 border-b border-border px-3 py-3" data-ui="timing-header">
          <div className="mx-auto flex w-full min-w-0 max-w-[640px] items-start gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={copy.cancelTiming}
              disabled={busy}
              onClick={closeTiming}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1">
              <h2
                ref={timingHeadingRef}
                tabIndex={-1}
                className="text-ui-heading font-semibold outline-none"
              >
                {ui.adjust}
              </h2>
              <p className="mt-1 text-ui-body wrap-anywhere">{targetTitle}</p>
            </div>
          </div>
        </header>
      ) : (
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
              <p className="m-0 text-ui-meta text-muted-foreground">
                {mode === "favorite"
                  ? favoritesCopy(locale).readonly
                  : targetLanguage.toUpperCase() +
                    " · " +
                    learningLevelLabel(locale, document.profile.level)}
              </p>
              <strong
                className="block truncate text-ui-heading font-semibold"
                title={document.source.title}
              >
                {document.source.title}
              </strong>
            </div>
            {favoriteControl ? (
              favoriteControl(scene)
            ) : (
              <SceneFavoriteButton
                sceneTitle={scene.title}
                documentId={favoriteOrigin?.documentId ?? document.id}
                sceneId={favoriteOrigin?.sceneId ?? scene.id}
                sceneIds={
                  favoriteOrigin
                    ? [favoriteOrigin.sceneId]
                    : document.sections.map(section => section.id)
                }
                locale={locale}
                ready={progressReady}
              />
            )}
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
                  <p
                    className="mt-2 text-ui-label leading-relaxed text-muted-foreground"
                    role="status"
                  >
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
                      await (onOpenVideo ? onOpenVideo() : openOrFocusVideoTab(adapter, sourceUrl));
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
      )}

      <div
        ref={contentRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 @min-[774px]/reader:[scrollbar-gutter:stable_both-edges]"
        data-ui="lessonContent"
      >
        <div
          ref={sceneMotionRef}
          className={"mx-auto w-full min-w-0 " + (editing ? "max-w-[640px]" : "max-w-[720px]")}
        >
          {editing && draft ? (
            <section aria-label={ui.adjust} className="grid gap-4" data-ui="reader-timing-editor">
              <TimingPositionControl
                locale={locale}
                currentMs={currentMs}
                playing={playing}
                seekDisabled={busy || needsReload || currentMs === null || !adapter.seek}
                toggleDisabled={busy || needsReload || !adapter.play || !adapter.pause}
                onSeek={delta => jump(currentMs! + delta)}
                onToggle={togglePlayback}
              />
              <TimingRangeTimeline
                locale={locale}
                startMs={draft.startMs}
                endMs={draft.endMs}
                currentMs={currentMs}
                disabled={busy}
                onSeek={needsReload || !adapter.seek ? undefined : jump}
                onChange={(boundary, value) => {
                  setDraft({ ...draft, [boundary === "start" ? "startMs" : "endMs"]: value });
                  setDraftReset(false);
                  setStatus("");
                }}
              />
              <div className="grid gap-3 border-t border-border pt-3">
                {(["startMs", "endMs"] as const).map(boundary => (
                  <TimingBoundaryField
                    key={boundary}
                    label={boundary === "startMs" ? ui.start : ui.end}
                    htmlFor={`reader-timing-${boundary}`}
                    captureLabel={boundary === "startMs" ? ui.setStart : ui.setEnd}
                    captureDisabled={
                      busy || needsReload || currentMs === null || !adapter.pause || !adapter.status
                    }
                    onCapture={() => markBoundary(boundary === "startMs" ? "start" : "end")}
                    nudgeDisabled={delta =>
                      busy || !isLoopWindow({ ...draft, [boundary]: draft[boundary] + delta })
                    }
                    onNudge={delta => nudgeTiming(boundary, delta)}
                    preview={{
                      label: boundary === "startMs" ? ui.previewStart : ui.previewEnd,
                      disabled: busy || needsReload || !adapter.loop || !isLoopWindow(draft),
                      onClick: () => previewBoundary(boundary),
                    }}
                  >
                    <TimingTimeInput
                      id={`reader-timing-${boundary}`}
                      milliseconds={draft[boundary]}
                      disabled={busy}
                      aria-invalid={!isLoopWindow(draft)}
                      onChange={value => {
                        setDraft({ ...draft, [boundary]: value });
                        setDraftReset(false);
                        setStatus("");
                      }}
                      onKeyDown={event => {
                        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                        event.preventDefault();
                        nudgeTiming(
                          boundary,
                          (event.key === "ArrowUp" ? 100 : -100) * (event.shiftKey ? 10 : 1),
                        );
                      }}
                    />
                  </TimingBoundaryField>
                ))}
                <p className="text-ui-label leading-relaxed text-muted-foreground">
                  {timingControlsCopy[locale].step}
                </p>
              </div>
              {(status || !isLoopWindow(draft)) && (
                <p role="status" className="text-ui-body text-destructive">
                  {status || ui.invalidRange}
                </p>
              )}
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

      {editing && draft ? (
        <footer
          className="shrink-0 border-t border-border bg-card px-3 py-3"
          data-ui="timing-footer"
        >
          <div className="mx-auto grid w-full min-w-0 max-w-[640px] gap-3">
            <Button
              variant="secondary"
              className="w-full"
              disabled={busy || needsReload || !adapter.loop || !isLoopWindow(draft)}
              onClick={managedRef.current && playing ? togglePlayback : previewTiming}
            >
              {managedRef.current && playing ? (
                <Pause aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
              {managedRef.current && playing ? subtitleEditorCopy[locale].stop : ui.preview}
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
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
              <div className="flex items-center gap-2">
                <Button variant="outline" disabled={busy} onClick={closeTiming}>
                  {copy.cancelTiming}
                </Button>
                <Button
                  disabled={busy || !isLoopWindow(draft)}
                  onClick={() => saveTiming(draftReset ? null : draft)}
                >
                  {copy.saveTiming}
                </Button>
              </div>
            </div>
          </div>
        </footer>
      ) : sourceUrl && adapter.id !== "import" && adapter.loop ? (
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
                className="min-w-0 flex-1 truncate text-ui-meta text-muted-foreground"
                title={targetTitle}
              >
                {target.type === "sentence" ? targetTitle : playing ? ui.playing : ui.ready}
              </span>
              {target.type === "sentence" && playing && (
                <span className="shrink-0 text-ui-meta text-muted-foreground">{ui.playing}</span>
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
                  className="h-8 min-h-8 w-14 gap-1 px-1 text-ui-label [&_svg]:size-2.5 @min-[360px]:w-20 @min-[360px]:px-2 @min-[360px]:[&_svg]:size-3.5"
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
