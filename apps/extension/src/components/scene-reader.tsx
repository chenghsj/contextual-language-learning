import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Play, Repeat2, SlidersHorizontal, Square } from "lucide-react";
import { nextStudyStep, readSceneProgress, STUDY_STEPS, type StudyStep } from "./scene-navigation";
import { formatTime, type LearningDocument, type StudyScene, type SubtitleCue } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { sceneReaderMessages } from "../i18n/scene-reader";
import { cuePlaybackStart, cuePlaybackWindow, openOrFocusVideoTab } from "../video/tab";
import {
  adjustLoopBoundary, formatLoopTimestamp, readLoopWindows,
  type LoopBoundary, type LoopWindow,
} from "../video/loop-window";
import type { VideoAdapter } from "../video/types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { SelectField } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { SettingInfo } from "./setting-info";

type SceneDocument = Extract<LearningDocument, { schemaVersion: 2 }>;
type Mode = "learn" | "review";
type Hint = "progressive" | "original" | "bilingual";
type Repeat = "2" | "3" | "5" | "infinite";

type Props = {
  document: SceneDocument;
  adapter: VideoAdapter;
  locale: UiLocale;
  repeat: Repeat;
  setRepeat: (value: Repeat) => void;
  delay: number;
  setDelay: (value: number) => void;
  playbackRate: number;
  setPlaybackRate: (value: number) => void;
  onError: (message: string) => void;
  onDownload: (format: "json" | "md") => void;
};

function focusCue(scene: StudyScene, cues: ReadonlyMap<string, SubtitleCue>): SubtitleCue | undefined {
  return scene.focusCueIds.map(id => cues.get(id)).find(cue => !!cue && cue.startMs !== null && cue.endMs !== null && cue.endMs > cue.startMs);
}

export function SceneReader({
  document, adapter, locale, repeat, setRepeat, delay, setDelay, playbackRate,
  setPlaybackRate, onError, onDownload,
}: Props) {
  const c = sceneReaderMessages[locale];
  const [mode, setMode] = useState<Mode>("learn");
  const [sceneIndex, setSceneIndex] = useState(0);
  const [stepByScene, setStepByScene] = useState<Record<string, StudyStep>>({});
  const [hint, setHint] = useState<Hint>("progressive");
  const [showOriginal, setShowOriginal] = useState<boolean | null>(null);
  const [showTranslation, setShowTranslation] = useState<boolean | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [answer, setAnswer] = useState("");
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [playbackSettingsOpen, setPlaybackSettingsOpen] = useState(false);
  const [loopingSceneId, setLoopingSceneId] = useState<string | null>(null);
  const [loopRanges, setLoopRanges] = useState<Record<string, LoopWindow>>({});
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const cues = useMemo(() => new Map(document.cues.map(cue => [cue.id, cue])), [document.cues]);
  const scene = document.sections[sceneIndex] ?? document.sections[0];
  const step: StudyStep = stepByScene[scene.id] ?? "listen";
  const sourceUrl = document.source.url;
  const progressKey = "sceneStudy:" + document.id;
  const hintKey = "sceneHint";
  const loopKey = "sceneLoopRanges:" + document.id;
  const canPlay = !!sourceUrl && !!adapter.loop && scene.startMs !== null && scene.endMs !== null;
  const selectedFocusCue = focusCue(scene, cues);
  const selectedFocusRange = selectedFocusCue && selectedFocusCue.startMs !== null &&
    selectedFocusCue.endMs !== null
    ? loopRanges[selectedFocusCue.id] ?? cuePlaybackWindow(selectedFocusCue.startMs, selectedFocusCue.endMs)
    : null;
  const focusLoopActive = loopingSceneId === scene.id;
  const originalVisible = showOriginal ?? hint !== "progressive";
  const translationVisible = showTranslation ?? hint === "bilingual";

  useEffect(() => {
    let live = true;
    void chrome.storage.local.get([progressKey, hintKey, loopKey]).then(stored => {
      if (!live) return;
      const saved = readSceneProgress(stored[progressKey],
        document.sections.map(item => item.id));
      if (saved.sceneId) {
        const index = document.sections.findIndex(item => item.id === saved.sceneId);
        if (index >= 0) setSceneIndex(index);
      }
      setCompletedIds(saved.completedIds);
      setStepByScene(saved.steps);
      setLoopRanges(readLoopWindows(stored[loopKey], document.cues.map(cue => cue.id)));
      const previousHint = stored[hintKey];
      if (typeof previousHint === "string" && ["progressive", "original", "bilingual"].includes(previousHint)) {
        setHint(previousHint as Hint);
      }
    }).catch(() => undefined).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [document.id, document.sections, document.cues, progressKey, loopKey]);

  useEffect(() => {
    if (!loaded) return;
    void chrome.storage.local.set({
      [progressKey]: { sceneId: scene.id, completedIds, steps: stepByScene },
      [hintKey]: hint,
      [loopKey]: loopRanges,
    }).catch(() => undefined);
  }, [loaded, progressKey, scene.id, completedIds, stepByScene, hint, hintKey, loopKey, loopRanges]);

  function selectScene(index: number): void {
    if (busy || !Number.isInteger(index) || index < 0 ||
      index >= document.sections.length || index === sceneIndex) return;
    // Stop any loop owned by the previous scene so it cannot keep repeating
    // an unrelated line after navigation. This does not seek the video.
    if (loopingSceneId && sourceUrl && adapter.stopLoop) {
      // Keep new playback disabled until the old scene's loop is cancelled.
      // Otherwise the late stop response could cancel the new scene's playback.
      setBusy(true);
      void adapter.stopLoop(sourceUrl)
        .catch(error => onError(error instanceof Error ? error.message : c.unavailable))
        .finally(() => setBusy(false));
      setLoopingSceneId(null);
    }
    setSceneIndex(index);
    // Each scene keeps its own last visited study step; switching never marks
    // the previous scene complete or seeks to the new scene's position.
    setShowOriginal(null);
    setShowTranslation(null);
    setShowAnswer(false);
    setAnswer("");
    setStatus("");
  }

  function selectStep(next: StudyStep): void {
    setStepByScene(previous => ({ ...previous, [scene.id]: next }));
    setShowAnswer(false);
    setStatus("");
  }

  async function openVideo(): Promise<void> {
    if (!sourceUrl) return;
    setBusy(true);
    try {
      await openOrFocusVideoTab(adapter, sourceUrl);
      setStatus(c.videoOpened);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function playScene(): Promise<void> {
    if (!canPlay || !sourceUrl || scene.startMs === null || scene.endMs === null || !adapter.loop) return;
    setBusy(true);
    try {
      await adapter.loop(sourceUrl, {
        startMs: cuePlaybackStart(scene.startMs), endMs: scene.endMs + 400,
        repeats: 1, delaySeconds: 0,
      });
      setLoopingSceneId(null);
      setStatus(c.playbackStarted);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function playFocus(cue: SubtitleCue | undefined, isLoop = true): Promise<void> {
    if (!sourceUrl || !cue || cue.startMs === null || cue.endMs === null || cue.endMs <= cue.startMs || !adapter.loop) return;
    setBusy(true);
    try {
      await adapter.loop(sourceUrl, {
        ...(loopRanges[cue.id] ?? cuePlaybackWindow(cue.startMs, cue.endMs)),
        repeats: isLoop ? repeat === "infinite" ? "infinite" : Number(repeat) : 1,
        delaySeconds: isLoop ? delay : 0,
      });
      setLoopingSceneId(isLoop ? scene.id : null);
      setStatus(isLoop ? c.loopStarted : c.playbackStarted);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function stopLoop(): Promise<void> {
    if (!sourceUrl || !adapter.stopLoop) return;
    setBusy(true);
    try {
      await adapter.stopLoop(sourceUrl);
      setLoopingSceneId(null);
      setStatus(c.loopStopped);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function toggleFocusLoop(): Promise<void> {
    if (focusLoopActive) await stopLoop();
    else await playFocus(selectedFocusCue);
  }


  /** A/B edits stop the old loop first, so the player never keeps using stale bounds. */
  async function updateFocusRange(boundary: LoopBoundary | "reset", position: number | "current" = 0): Promise<void> {
    if (busy || !selectedFocusCue || !selectedFocusRange) return;
    setBusy(true);
    try {
      let next: LoopWindow | null = null;
      if (boundary !== "reset") {
        let target = position;
        if (position === "current") {
          if (!sourceUrl || !adapter.status) {
            setStatus(c.positionUnavailable);
            return;
          }
          const playback = await adapter.status(sourceUrl);
          if (typeof playback.currentMs !== "number" || !Number.isFinite(playback.currentMs)) {
            setStatus(c.positionUnavailable);
            return;
          }
          target = playback.currentMs;
        }
        next = adjustLoopBoundary(selectedFocusRange, boundary, target as number);
        if (!next) {
          setStatus(c.invalidLoopRange);
          return;
        }
      }
      if (focusLoopActive && sourceUrl && adapter.stopLoop) {
        await adapter.stopLoop(sourceUrl);
        setLoopingSceneId(null);
      }
      const cueId = selectedFocusCue.id;
      setLoopRanges(previous => {
        const updated = { ...previous };
        if (next) updated[cueId] = next;
        else delete updated[cueId];
        return updated;
      });
      setStatus(next ? c.loopRangeSaved : c.loopRangeReset);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function changeRate(value: number): Promise<void> {
    if (!sourceUrl || !adapter.setPlaybackRate) return;
    setBusy(true);
    try {
      await adapter.setPlaybackRate(sourceUrl, value);
      setPlaybackRate(value);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  function finishScene(): void {
    setCompletedIds(previous => previous.includes(scene.id) ? previous : [...previous, scene.id]);
    setStatus(c.stepDone);
    // Completion and navigation are separate actions. Leave the scene in view
    // so the learner can review it or choose any other scene explicitly.
  }

  function renderOriginal(line: SubtitleCue, index: number) {
    const translation = scene.translations.find(item => item.cueId === line.id);
    return <div className="sceneUtterance" key={line.id}>
      <span className="sceneLineNumber">{index + 1}</span>
      <div>
        <p lang={document.profile.targetLanguage}>{line.originalText}</p>
        {translationVisible
          ? <p className="sceneTranslation">{translation?.text}</p> : null}
      </div>
    </div>;
  }

  return <div className="sceneReader">
    <Card className="panel">
      <div className="sceneHeader">
        <div className="sceneHeaderTitle">
          <strong>{document.source.title}</strong>
          <span className="hint">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level} · {completedIds.length}/{document.sections.length} {c.completed}</span>
        </div>
        <div className="sceneExport">
          <Button variant="outline" size="sm" onClick={() => onDownload("json")}>JSON</Button>
          <Button variant="outline" size="sm" onClick={() => onDownload("md")}>MD</Button>
        </div>
      </div>
      <div className="sceneTabs" role="tablist" aria-label={c.scene}>
        {(["learn", "review"] as const).map(tab =>
          <Button key={tab} role="tab" aria-selected={mode === tab}
            className={mode === tab ? "selected" : ""}
            onClick={() => { setMode(tab); setStatus(""); }}>
            {c[tab]}
          </Button>)}
      </div>
    </Card>

    {mode === "learn" && <>
      <Card className="panel">
        <div className="sceneHeading">
          <span className="chip">{c.scene} {sceneIndex + 1} / {document.sections.length}</span>
          <span className="time">{formatTime(scene.startMs)}–{formatTime(scene.endMs)}</span>
        </div>
        <div className="scenePicker">
          <label htmlFor="study-scene-picker">{c.chooseScene}</label>
          <SelectField id="study-scene-picker" ariaLabel={c.chooseScene}
            value={String(sceneIndex)} disabled={busy}
            onValueChange={value => selectScene(Number(value))}
            options={document.sections.map((item, index) => ({
              value: String(index),
              label: c.scene + " " + (index + 1) + " · " + item.title +
                " (" + formatTime(item.startMs) + "–" + formatTime(item.endMs) + ")" +
                (completedIds.includes(item.id) ? " ✓ " + c.completed : ""),
            }))} />
        </div>
        <h2>{scene.title}</h2>
        <div className="sceneQuickPlay">
          <Button size="sm" variant="outline" disabled={busy || !canPlay}
            onClick={() => void playScene()}>
            <Play aria-hidden="true" />{c.playScene}
          </Button>
          {!canPlay && <p className="hint">
            {!sourceUrl || adapter.id === "import" ? c.noVideo : c.noTime}
          </p>}
        </div>
        <p className="hint">{scene.context}</p>
        <p className="sceneGoal"><strong>{c.goal}:</strong> {scene.learningGoal}</p>
        <nav className="sceneSteps" aria-label={c.studySteps}>
          {STUDY_STEPS.map((part, index) =>
            <Button key={part} variant={step === part ? "default" : "outline"}
              type="button" aria-pressed={step === part}
              aria-describedby={step === part ? "scene-step-hint" : undefined}
              onClick={() => selectStep(part)}>
              <span className="sceneStepNumber" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="sceneStepLabel">{c[part]}</span>
            </Button>)}
        </nav>
        <p className="sceneStepHint" id="scene-step-hint">
          {step === "listen" ? c.listenHint : step === "understand" ? c.understandHint : c.practiceHint}
        </p>
        <details className="sceneReadingSettings">
          <summary>{c.hintLabel} · {c[hint]}</summary>
          <div className="sceneReadingControl">
            <SelectField ariaLabel={c.hintLabel} value={hint} onValueChange={value => {
              setHint(value as Hint);
              setShowOriginal(null);
              setShowTranslation(null);
            }} options={[
              { value: "progressive", label: c.progressive },
              { value: "original", label: c.original },
              { value: "bilingual", label: c.bilingual },
            ]} />
            <SettingInfo label={c.hintLabel} infoLabel={c.hintInfo}
              explanation={c.originalSubtitleNotice} />
          </div>
        </details>
        {step === "listen" && <>
          {originalVisible && <div className="sceneDialogue">
            {scene.cueIds.map(id => cues.get(id)).filter((cue): cue is SubtitleCue => !!cue)
              .map((cue, index) => renderOriginal(cue, index))}
          </div>}
          <Button size="sm" variant="outline" onClick={() => setShowOriginal(current => !(current ?? hint !== "progressive"))}>
            {originalVisible ? c.hideOriginal : c.showOriginal}
          </Button>
        </>}
        {step === "understand" && <>
          <div className="sceneDialogue">
            {scene.cueIds.map(id => cues.get(id)).filter((cue): cue is SubtitleCue => !!cue)
              .map((cue, index) => renderOriginal(cue, index))}
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowTranslation(current => !(current ?? hint === "bilingual"))}>
            {translationVisible ? c.hideTranslation : c.showTranslation}
          </Button>
          {scene.vocabulary.length > 0 && <div className="sceneFocus">
            <h3>{c.focus}</h3>
            {scene.vocabulary.map(word => <div className="learningCard" key={word.expression}>
              <strong lang={document.profile.targetLanguage}>{word.expression}</strong>
              <span>{word.meaning}</span>
              <p>{word.explanation}</p>
              {word.example && <p lang={document.profile.targetLanguage}>{word.example}</p>}
            </div>)}
          </div>}
          {scene.insights.length > 0 && <details><summary>{c.insight}</summary>
            {scene.insights.map((note, index) => <p key={index}>{note}</p>)}
          </details>}
        </>}
        {step === "practice" && <>
          {scene.exercises.length > 0 ? scene.exercises.map((exercise, index) =>
            <div className="scenePractice" key={index}>
              <p>{exercise.question}</p>
              <Textarea aria-label={c.answerPlaceholder} rows={3} value={answer}
                placeholder={c.answerPlaceholder} onChange={event => setAnswer(event.target.value)} />
              <Button variant="outline" size="sm" onClick={() => setShowAnswer(current => !current)}>
                {showAnswer ? c.hideAnswer : c.showAnswer}
              </Button>
              {showAnswer && <p className="sceneSample" lang={document.profile.targetLanguage}>{exercise.answer}</p>}
            </div>) : <p className="hint">{c.noPractice}</p>}
        </>}
        <div className="sceneStageNavigation">
          <Button disabled={step === "practice" && completedIds.includes(scene.id)}
            onClick={() => {
              const next = nextStudyStep(step);
              if (next) selectStep(next);
              else finishScene();
            }}>
            {step === "listen" ? c.toUnderstand : step === "understand" ? c.toPractice
              : completedIds.includes(scene.id) ? c.sceneCompleted : c.finish}
          </Button>
        </div>
        <nav className="sceneNavigation" aria-label={c.sceneNavigation}>
          <Button variant="outline" size="sm" disabled={busy || sceneIndex === 0}
            onClick={() => selectScene(sceneIndex - 1)}>{c.previousScene}</Button>
          <span className="sceneNavPosition">{sceneIndex + 1} / {document.sections.length}</span>
          <Button variant="outline" size="sm"
            disabled={busy || sceneIndex === document.sections.length - 1}
            onClick={() => selectScene(sceneIndex + 1)}>{c.nextScene}</Button>
        </nav>
      </Card>
    </>}

    {mode === "review" && <Card className="panel">
      <h2>{c.review}</h2>
      <p className="hint">{c.reviewHint}</p>
      {document.sections.every(item => item.vocabulary.length === 0) && <p className="hint">{c.noExpressions}</p>}
      {document.sections.flatMap(item => item.vocabulary.map(word => ({ item, word }))).map(({ item, word }) => {
        const key = item.id + ":" + word.expression;
        const line = focusCue(item, cues);
        return <div className="learningCard" key={key}>
          <strong>{item.title}</strong>
          <div className="actions">
            <Button size="sm" variant="outline" disabled={busy || !sourceUrl || !adapter.loop || !line}
              onClick={() => void playFocus(line, false)}>{c.playOriginal}</Button>
            <Button size="sm" variant="outline" onClick={() =>
              setRevealed(previous => ({ ...previous, [key]: !previous[key] }))}>
              {revealed[key] ? c.conceal : c.reveal}
            </Button>
          </div>
          {revealed[key] && <p><strong lang={document.profile.targetLanguage}>{word.expression}</strong> — {word.meaning}</p>}
        </div>;
      })}
      <Button variant="outline" size="sm" onClick={() => setMode("learn")}>{c.returnStudy}</Button>
    </Card>}

    {mode === "learn" && sourceUrl && adapter.id !== "import" && <Card
      className="panel scenePlayer" aria-label={c.miniPlayer}>
      <div className="sceneMiniHeader">
        <div className="sceneMiniTitle">
          <span className="time">{c.scene} {sceneIndex + 1} · {formatTime(scene.startMs)}–{formatTime(scene.endMs)}</span>
          <strong title={scene.title}>{scene.title}</strong>
        </div>
        <Button size="icon" variant="ghost" aria-label={c.openVideo}
          title={c.openVideo} disabled={busy} onClick={() => void openVideo()}>
          <ExternalLink aria-hidden="true" />
        </Button>
      </div>
      <div className="sceneMiniControls">
        <Button size="sm" className="sceneMiniLoop" variant={focusLoopActive ? "secondary" : "default"}
          aria-pressed={focusLoopActive}
          disabled={busy || !selectedFocusCue || !adapter.loop ||
            (focusLoopActive && !adapter.stopLoop)}
          onClick={() => void toggleFocusLoop()}>
          {focusLoopActive ? <Square aria-hidden="true" /> : <Repeat2 aria-hidden="true" />}
          {focusLoopActive ? c.stopLoop : c.repeatFocus}
        </Button>
        <Button size="sm" variant="outline" className="sceneMiniSettingsToggle"
          aria-expanded={playbackSettingsOpen}
          aria-controls={playbackSettingsOpen ? "scene-playback-options" : undefined}
          onClick={() => setPlaybackSettingsOpen(open => !open)}>
          <SlidersHorizontal aria-hidden="true" />{c.playbackOptions}
        </Button>
      </div>
      {playbackSettingsOpen && <div className="sceneMiniSettings" id="scene-playback-options"
        role="region" aria-label={c.playbackOptions}>
        <div className="twoColumns">
          <label>{c.repeat}
            <SelectField ariaLabel={c.repeat} value={repeat}
              onValueChange={value => setRepeat(value as Repeat)}
              options={[
                { value: "2", label: "2×" }, { value: "3", label: "3×" },
                { value: "5", label: "5×" }, { value: "infinite", label: "∞" },
              ]} />
          </label>
          <label>{c.delay}
            <SelectField ariaLabel={c.delay} value={delay}
              onValueChange={value => setDelay(Number(value))}
              options={[0, 1, 2, 3].map(value => ({ value, label: value + "s" }))} />
          </label>
        </div>
        {adapter.setPlaybackRate && <label>{c.speed}
          <SelectField ariaLabel={c.speed} value={playbackRate} disabled={busy}
            onValueChange={value => void changeRate(Number(value))}
            options={[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5].map(rate => ({
              value: rate, label: rate + "×",
            }))} />
        </label>}

        <div className="sceneLoopRange" role="group" aria-label={c.loopRange}>
          <div className="sceneLoopRangeTitle">
            <strong>{c.loopRange}</strong>
            <Button variant="outline" size="sm" disabled={busy || !selectedFocusCue ||
              !loopRanges[selectedFocusCue.id]}
              onClick={() => void updateFocusRange("reset")}>{c.loopRangeResetButton}</Button>
          </div>
          <p className="hint">{c.loopRangeHint}</p>
          {selectedFocusRange ? (["start", "end"] as const).map(boundary => {
            const point = boundary === "start" ? selectedFocusRange.startMs : selectedFocusRange.endMs;
            const name = boundary === "start" ? c.loopStart : c.loopEnd;
            return <div className="sceneLoopBoundary" key={boundary}>
              <div className="sceneLoopBoundaryTitle">
                <span>{name}</span>
                <output>{formatLoopTimestamp(point)}</output>
              </div>
              <div className="sceneLoopNudge">
                <Button variant="outline" size="sm" disabled={busy}
                  aria-label={name + " " + c.loopEarlier}
                  onClick={() => void updateFocusRange(boundary, point - 500)}>−0.5s</Button>
                <Button variant="outline" size="sm" disabled={busy}
                  aria-label={name + " " + c.loopLater}
                  onClick={() => void updateFocusRange(boundary, point + 500)}>+0.5s</Button>
                <Button variant="outline" size="sm" disabled={busy || !adapter.status}
                  onClick={() => void updateFocusRange(boundary, "current")}>
                  {c.setBoundaryHere}
                </Button>
              </div>
            </div>;
          }) : <p className="hint">{c.noTime}</p>}
        </div>
      </div>}
      {status && <p className="sceneMiniStatus" role="status">{status}</p>}
    </Card>}
  </div>;
}
