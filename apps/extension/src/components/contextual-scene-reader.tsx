import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Play, Repeat2, Square } from "lucide-react";
import { formatTime, type LearningDocument, type SubtitleCue } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { contextualReaderMessages, contextualText } from "../i18n/contextual-reader";
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
  delay: number;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  onError: (message: string) => void;
  onDownload: (format: "json" | "md") => void;
};

/** V3 is readable as one cohesive scene. V1/V2 keep their original reader. */
export function ContextualSceneReader({
  document, adapter, locale, repeat, delay, playbackRate, setPlaybackRate, onError, onDownload,
}: Props) {
  const copy = contextualReaderMessages[locale];
  const cues = useMemo(() => new Map(document.cues.map(cue => [cue.id, cue])), [document.cues]);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [selectionByScene, setSelectionByScene] = useState<Record<string, string>>({});
  const [translationVisible, setTranslationVisible] = useState(false);
  const [expandedExamples, setExpandedExamples] = useState<Record<string, boolean>>({});
  const [exampleTranslations, setExampleTranslations] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loopingCueId, setLoopingCueId] = useState<string | null>(null);
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
  const supportsCue = (cue: SubtitleCue | undefined): cue is SubtitleCue =>
    !!cue && cue.startMs !== null && cue.endMs !== null && cue.endMs > cue.startMs;

  useEffect(() => {
    let live = true;
    void chrome.storage.local.get(progressKey).then(saved => {
      if (!live) return;
      const progress = saved[progressKey] as {
        sceneId?: string; selectionByScene?: Record<string, string>;
      } | undefined;
      if (progress?.sceneId) {
        const index = document.sections.findIndex(item => item.id === progress.sceneId);
        if (index >= 0) setSceneIndex(index);
      }
      if (progress?.selectionByScene && typeof progress.selectionByScene === "object") {
        const valid = Object.fromEntries(document.sections.flatMap(item => {
          const id = progress.selectionByScene?.[item.id];
          return id && item.cueIds.includes(id) ? [[item.id, id]] : [];
        }));
        setSelectionByScene(valid);
      }
    }).catch(() => undefined).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [document.id, document.sections, progressKey]);

  useEffect(() => {
    if (!loaded) return;
    void chrome.storage.local.set({
      [progressKey]: { sceneId: scene.id, selectionByScene },
    }).catch(() => undefined);
  }, [loaded, progressKey, scene.id, selectionByScene]);

  async function stopPreviousLoop(): Promise<void> {
    if (!loopingCueId) return;
    if (sourceUrl && adapter.stopLoop) await adapter.stopLoop(sourceUrl);
    setLoopingCueId(null);
  }

  async function selectScene(index: number): Promise<void> {
    if (busy || index === sceneIndex || index < 0 || index >= document.sections.length) return;
    setBusy(true);
    try {
      await stopPreviousLoop();
      setSceneIndex(index);
      setTranslationVisible(false);
      setStatus("");
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function playScene(): Promise<void> {
    if (!sourceUrl || !adapter.loop || scene.startMs === null || scene.endMs === null) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function selectCue(id: string, play = true): Promise<void> {
    if (busy || !scene.cueIds.includes(id)) return;
    const cue = cues.get(id);
    setBusy(true);
    try {
      await stopPreviousLoop();
      setSelectionByScene(previous => ({ ...previous, [scene.id]: id }));
      if (play && sourceUrl && adapter.loop && supportsCue(cue)) {
        await adapter.loop(sourceUrl, {
          ...cuePlaybackWindow(cue.startMs!, cue.endMs!), repeats: 1, delaySeconds: 0,
        });
        setStatus(copy.playbackStarted);
      } else if (play && !supportsCue(cue)) {
        setStatus(copy.noTime);
      } else {
        setStatus("");
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function toggleLoop(): Promise<void> {
    if (!sourceUrl || !adapter.loop || !supportsCue(selectedCue) || busy) return;
    setBusy(true);
    try {
      if (loopingCueId === selectedCue.id) {
        await stopPreviousLoop();
        setStatus(copy.loopStopped);
      } else {
        await stopPreviousLoop();
        await adapter.loop(sourceUrl, {
          ...cuePlaybackWindow(selectedCue.startMs!, selectedCue.endMs!),
          repeats: repeat === "infinite" ? "infinite" : Number(repeat),
          delaySeconds: delay,
        });
        setLoopingCueId(selectedCue.id);
        setStatus(copy.loopStarted);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function changeRate(rate: number): Promise<void> {
    if (!sourceUrl || !adapter.setPlaybackRate || busy) return;
    setBusy(true);
    try {
      await adapter.setPlaybackRate(sourceUrl, rate);
      setPlaybackRate(rate);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function openVideo(): Promise<void> {
    if (!sourceUrl || busy) return;
    setBusy(true);
    try {
      await openOrFocusVideoTab(adapter, sourceUrl);
      setStatus(copy.videoOpened);
    } catch (error) {
      onError(error instanceof Error ? error.message : copy.unavailable);
    } finally {
      setBusy(false);
    }
  }

  return <div className="contextualReader">
    <Card className="panel contextualSceneHeader">
      <div className="contextualHeading">
        <div className="contextualHeaderTitle">
          <strong>{document.source.title}</strong>
          <span className="hint">{document.profile.targetLanguage.toUpperCase()} · {document.profile.level}</span>
        </div>
        <div className="sceneExport">
          <Button size="sm" variant="outline" onClick={() => onDownload("json")}>JSON</Button>
          <Button size="sm" variant="outline" onClick={() => onDownload("md")}>MD</Button>
        </div>
      </div>
      <div className="contextualScenePicker">
        <Button variant="outline" size="icon" aria-label={copy.previousScene}
          disabled={busy || sceneIndex === 0} onClick={() => void selectScene(sceneIndex - 1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <div>
          <span className="time">{copy.scene} {sceneIndex + 1} / {document.sections.length}</span>
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

    <Card className="panel contextualSceneContent">
      <div className="contextualSectionHeading">
        <div>
          <span className="time">{formatTime(scene.startMs)}–{formatTime(scene.endMs)}</span>
          <h2>{scene.title}</h2>
        </div>
        {sourceUrl && adapter.id !== "import" && <Button size="icon" variant="ghost"
          aria-label={copy.video} disabled={busy} onClick={() => void openVideo()}>
          <ExternalLink aria-hidden="true" />
        </Button>}
      </div>
      <p className="contextualSituation">{scene.context}</p>
      <Button variant="outline" className="contextualWholePlayback" disabled={busy || !canLoop ||
        scene.startMs === null || scene.endMs === null} onClick={() => void playScene()}>
        <Play aria-hidden="true" />{copy.playScene}
      </Button>
      {!canLoop && <p className="hint">{copy.noVideo}</p>}

      <div className="contextualSectionHeading contextualDialogueHeading">
        <h3>{copy.dialogue}</h3>
        <Button size="sm" variant="ghost" onClick={() => setTranslationVisible(value => !value)}>
          {translationVisible ? copy.hideTranslation : copy.translation}
          <ChevronDown aria-hidden="true" />
        </Button>
      </div>
      <p className="hint">{copy.subtitleNotice}</p>
      <div className="contextualDialogue" role="group" aria-label={copy.dialogue}>
        {lines.map((cue, index) => {
          const focused = scene.focusItems.some(item => item.sourceCueIds.includes(cue.id));
          const selected = selectedCueId === cue.id;
          const translation = scene.translations.find(row => row.cueId === cue.id);
          return <button key={cue.id} type="button"
            className={"contextualLine" + (selected ? " selected" : "")}
            aria-pressed={selected} disabled={busy} onClick={() => void selectCue(cue.id)}>
            <span className="contextualLineNumber">{String(index + 1).padStart(2, "0")}</span>
            <span className="contextualLineText">
              <span lang={document.profile.targetLanguage}>{cue.originalText}</span>
              {translationVisible && translation && <span className="contextualTranslation">{translation.text}</span>}
            </span>
            {focused && <span className="contextualFocusMarker">{copy.focus}</span>}
            <Play aria-hidden="true" className="contextualLinePlay" />
          </button>;
        })}
      </div>

      <div className="contextualExpressions">
        {scene.focusItems.map((focus, focusIndex) => {
          const key = scene.id + ":" + focusIndex;
          const more = expandedExamples[key] ?? false;
          const visibleExamples = more ? focus.examples : focus.examples.slice(0, 1);
          return <section className="contextualExpression" key={key}>
            <span className="contextualEyebrow">{copy.focus} {focusIndex + 1} / {scene.focusItems.length}</span>
            <h3 lang={document.profile.targetLanguage}>{focus.expression}</h3>
            <p className="contextualMeaning">{focus.meaning}</p>
            <div className="contextualEvidence">
              <strong>{copy.context}</strong>
              <p>{focus.contextExplanation}</p>
            </div>
            {focus.wordNotes.length > 0 && <details className="contextualWordNotes">
              <summary>{copy.words}</summary>
              {focus.wordNotes.map((word, index) =>
                <div className="contextualWord" key={index}>
                  <strong lang={document.profile.targetLanguage}>{word.surface}</strong>
                  <span>{word.meaning}</span>
                  <p>{word.explanation}</p>
                </div>)}
            </details>}
            <div className="contextualExamples">
              <div className="contextualSectionHeading">
                <h4>{copy.examples}</h4>
                <span className="time">{focus.examples.length}</span>
              </div>
              <p className="hint">{copy.aiExamples}</p>
              {visibleExamples.map((example, exampleIndex) => {
                const exampleKey = key + ":" + exampleIndex;
                const show = exampleTranslations[exampleKey] ?? false;
                return <div className="contextualExample" key={exampleKey}>
                  <p className="contextualExampleSituation">{example.situation}</p>
                  {example.dialogue.map((line, index) =>
                    <div key={index} className="contextualExampleLine">
                      <p lang={document.profile.targetLanguage}>{line.text}</p>
                      {show && <p className="contextualTranslation">{line.translation}</p>}
                    </div>)}
                  <Button size="sm" variant="ghost" onClick={() => setExampleTranslations(previous => ({
                    ...previous, [exampleKey]: !show,
                  }))}>{show ? copy.hideTranslation : copy.translation}</Button>
                </div>;
              })}
              {focus.examples.length > 1 && <Button size="sm" variant="ghost"
                className="contextualExpandExamples"
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

    {sourceUrl && adapter.id !== "import" && adapter.loop && <div className="contextualPlayer"
      role="region" aria-label={copy.playback}>
      <div className="contextualPlayerTitle">
        <span className="time">{copy.selected} · {selectedIndex + 1} / {scene.cueIds.length}</span>
        <strong lang={document.profile.targetLanguage} title={selectedCue?.originalText}>
          {selectedCue?.originalText}
        </strong>
      </div>
      <div className="contextualPlayerControls">
        <Button size="icon" variant="outline" aria-label={copy.previousCue}
          disabled={busy || selectedIndex === 0} onClick={() => void selectCue(scene.cueIds[selectedIndex - 1])}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button className="contextualPlayerLoop" size="sm"
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
      {status && <p className="contextualPlayerStatus" role="status">{status}</p>}
    </div>}
  </div>;
}
