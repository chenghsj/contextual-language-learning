import React, { useEffect, useMemo, useState } from "react";
import { nextStudyStep, readSceneProgress, STUDY_STEPS, type StudyStep } from "./scene-navigation";
import { formatTime, type LearningDocument, type StudyScene, type SubtitleCue } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { sceneReaderMessages } from "../i18n/scene-reader";
import { cuePlaybackStart, cuePlaybackWindow, openOrFocusVideoTab } from "../video/tab";
import type { VideoAdapter } from "../video/types";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";

type SceneDocument = Extract<LearningDocument, { schemaVersion: 2 }>;
type Mode = "watch" | "learn" | "review";
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
  return scene.focusCueIds.map(id => cues.get(id)).find(cue => !!cue && cue.startMs !== null && cue.endMs !== null);
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
  const [watchTime, setWatchTime] = useState<number | null>(null);
  const [watchAvailable, setWatchAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const cues = useMemo(() => new Map(document.cues.map(cue => [cue.id, cue])), [document.cues]);
  const scene = document.sections[sceneIndex] ?? document.sections[0];
  const step: StudyStep = stepByScene[scene.id] ?? "listen";
  const sourceUrl = document.source.url;
  const progressKey = "sceneStudy:" + document.id;
  const hintKey = "sceneHint";
  const canPlay = !!sourceUrl && !!adapter.loop && scene.startMs !== null && scene.endMs !== null;
  const selectedFocusCue = focusCue(scene, cues);
  const originalVisible = showOriginal ?? hint !== "progressive";
  const translationVisible = showTranslation ?? hint === "bilingual";
  const watchScene = watchTime === null ? undefined : document.sections.find(item =>
    item.startMs !== null && item.endMs !== null && watchTime >= item.startMs && watchTime <= item.endMs);

  useEffect(() => {
    let live = true;
    void chrome.storage.local.get([progressKey, hintKey]).then(stored => {
      if (!live) return;
      const saved = readSceneProgress(stored[progressKey],
        document.sections.map(item => item.id));
      if (saved.sceneId) {
        const index = document.sections.findIndex(item => item.id === saved.sceneId);
        if (index >= 0) setSceneIndex(index);
      }
      setCompletedIds(saved.completedIds);
      setStepByScene(saved.steps);
      const previousHint = stored[hintKey];
      if (typeof previousHint === "string" && ["progressive", "original", "bilingual"].includes(previousHint)) {
        setHint(previousHint as Hint);
      }
    }).catch(() => undefined).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [document.id, document.sections, progressKey]);

  useEffect(() => {
    if (!loaded) return;
    void chrome.storage.local.set({
      [progressKey]: { sceneId: scene.id, completedIds, steps: stepByScene },
      [hintKey]: hint,
    }).catch(() => undefined);
  }, [loaded, progressKey, scene.id, completedIds, stepByScene, hint, hintKey]);

  useEffect(() => {
    if (mode !== "watch" || !sourceUrl || !adapter.status) return;
    let live = true;
    const poll = () => {
      void adapter.status!(sourceUrl).then(result => {
        if (!live) return;
        setWatchTime(typeof result.currentMs === "number" ? result.currentMs : null);
        setWatchAvailable(true);
      }).catch(() => {
        if (live) { setWatchAvailable(false); setWatchTime(null); }
      });
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [mode, sourceUrl, adapter]);

  function selectScene(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= document.sections.length ||
      index === sceneIndex) return;
    setSceneIndex(index);
    // Each scene keeps its own last visited study step; switching never marks
    // the previous scene complete or changes the video's playback position.
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
      setStatus(c.playbackStarted);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function playFocus(cue: SubtitleCue | undefined, isLoop = true): Promise<void> {
    if (!sourceUrl || !cue || cue.startMs === null || cue.endMs === null || !adapter.loop) return;
    setBusy(true);
    try {
      await adapter.loop(sourceUrl, {
        ...cuePlaybackWindow(cue.startMs, cue.endMs),
        repeats: isLoop ? repeat === "infinite" ? "infinite" : Number(repeat) : 1,
        delaySeconds: isLoop ? delay : 0,
      });
      setStatus(isLoop ? c.loopStarted : c.playbackStarted);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function stopLoop(): Promise<void> {
    if (!sourceUrl || !adapter.stopLoop) return;
    try {
      await adapter.stopLoop(sourceUrl);
      setStatus(c.loopStopped);
    } catch (error) {
      onError(error instanceof Error ? error.message : c.unavailable);
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
        {(["watch", "learn", "review"] as const).map(tab =>
          <Button key={tab} role="tab" aria-selected={mode === tab}
            className={mode === tab ? "selected" : ""}
            onClick={() => { setMode(tab); setStatus(""); }}>
            {c[tab]}
          </Button>)}
      </div>
    </Card>

    {mode === "watch" && <Card className="panel">
      <h2>{c.watch}</h2>
      <p className="hint">{c.watchHint}</p>
      <p className="hint">{watchAvailable && watchTime !== null ? formatTime(watchTime) : c.watchUnavailable}</p>
      {watchScene ? <>
        <span className="chip">{formatTime(watchScene.startMs)}–{formatTime(watchScene.endMs)}</span>
        <h2>{watchScene.title}</h2>
        <p>{watchScene.context}</p>
        <Button onClick={() => {
          selectScene(document.sections.findIndex(item => item.id === watchScene.id));
          setMode("learn");
        }}>{c.studyThis}</Button>
      </> : <p className="hint">{c.watchNoScene}</p>}
      {sourceUrl && <Button variant="outline" onClick={() => void openVideo()} disabled={busy}>{c.openVideo}</Button>}
    </Card>}

    {mode === "learn" && <>
      <Card className="panel">
        <div className="sceneHeading">
          <span className="chip">{c.scene} {sceneIndex + 1} / {document.sections.length}</span>
          <span className="time">{formatTime(scene.startMs)}–{formatTime(scene.endMs)}</span>
        </div>
        <div className="scenePicker">
          <label htmlFor="study-scene-picker">{c.chooseScene}</label>
          <Select id="study-scene-picker" value={String(sceneIndex)}
            onChange={event => selectScene(Number(event.target.value))}>
            {document.sections.map((item, index) => (
              <option key={item.id} value={index}>
                {c.scene} {index + 1} · {item.title} ({formatTime(item.startMs)}–{formatTime(item.endMs)})
                {completedIds.includes(item.id) ? " ✓ " + c.completed : ""}
              </option>
            ))}
          </Select>
        </div>
        <h2>{scene.title}</h2>
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
          <Button variant="outline" size="sm" disabled={sceneIndex === 0}
            onClick={() => selectScene(sceneIndex - 1)}>{c.previousScene}</Button>
          <span className="sceneNavPosition">{sceneIndex + 1} / {document.sections.length}</span>
          <Button variant="outline" size="sm" disabled={sceneIndex === document.sections.length - 1}
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

    {mode === "learn" && <Card className="panel scenePlayer">
      <div className="sceneHeading"><strong>{c.playback}</strong>
        <span className="time">{formatTime(scene.startMs)}</span>
      </div>
      {!sourceUrl || adapter.id === "import" ? <p className="hint">{c.noVideo}</p> : <>
        <div className="actions">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void openVideo()}>{c.openVideo}</Button>
          <Button size="sm" disabled={busy || !canPlay} onClick={() => void playScene()}>{c.playScene}</Button>
          <Button size="sm" variant="outline" disabled={busy || !selectedFocusCue || !adapter.loop}
            onClick={() => void playFocus(selectedFocusCue)}>{c.repeatFocus}</Button>
          <Button size="sm" variant="outline" disabled={!adapter.stopLoop} onClick={() => void stopLoop()}>
            {c.stopLoop}
          </Button>
        </div>
        {!canPlay && <p className="hint">{c.noTime}</p>}
        <details className="scenePlaybackSettings">
          <summary>{c.playback}</summary>
          <div className="twoColumns">
            <label>{c.repeat}
              <Select value={repeat} onChange={event => setRepeat(event.target.value as Repeat)}>
                <option value="2">2×</option><option value="3">3×</option>
                <option value="5">5×</option><option value="infinite">∞</option>
              </Select>
            </label>
            <label>{c.delay}
              <Select value={delay} onChange={event => setDelay(Number(event.target.value))}>
                {[0, 1, 2, 3].map(value =>
                  <option key={value} value={value}>{value}s</option>)}
              </Select>
            </label>
          </div>
          {adapter.setPlaybackRate && <label>{c.speed}
            <Select value={playbackRate} disabled={busy}
              onChange={event => void changeRate(Number(event.target.value))}>
              {[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5].map(rate =>
                <option value={rate} key={rate}>{rate}×</option>)}
            </Select>
          </label>}
        </details>
      </>}
      {status && <p className="status" role="status">{status}</p>}
      <p className="hint">{c.originalSubtitleNotice}</p>
      <label>{c.hintLabel}
        <Select value={hint} onChange={event => { setHint(event.target.value as Hint);
          setShowOriginal(null); setShowTranslation(null); }}>
          <option value="progressive">{c.progressive}</option>
          <option value="original">{c.original}</option>
          <option value="bilingual">{c.bilingual}</option>
        </Select>
      </label>
    </Card>}
  </div>;
}
