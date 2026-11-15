import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, Play } from "lucide-react";
import {
  readerPresentation,
  type ReaderGroup,
  subtitleSpeechText,
  type ReaderAnalysis,
  type LearningSceneV7,
  subtitlePronunciationSegments,
  pronunciationSlice,
  findExpressionOccurrences,
  type LearningDocument,
  type FavoriteReaderDocument,
  type SubtitlePronunciationSegment,
  type ExpressionOccurrence,
} from "@contextual/core";
import { pronunciationDiagnosticCopy } from "../i18n/pronunciation-diagnostics";
import type { UiLocale } from "../i18n/messages";
import { contextualReaderMessages } from "../i18n/contextual-reader";
import { sentenceAnalysisCopy } from "../i18n/sentence-analysis";
import { speechCopy } from "../i18n/speech";
import { SpeechButton } from "./system-speech";
import { formatLoopTimestamp } from "../video/loop-window";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

function ExplanationText({ text, terms }: { text: string; terms: string[] }) {
  const paragraphs: string[] = [];
  for (const line of text.split(/\n+/).filter(Boolean)) {
    let paragraph = "";
    for (const sentence of line.match(/[\s\S]+?(?:[。！？]+[」』）]?|$)/gu) ?? [line]) {
      if (paragraph && paragraph.length + sentence.length > 100) {
        paragraphs.push(paragraph);
        paragraph = "";
      }
      paragraph += sentence;
    }
    if (paragraph) paragraphs.push(paragraph);
  }
  const keywords = [...new Set(terms.filter(term => term.trim() && term.length <= 40))].sort(
    (a, b) => b.length - a.length,
  );
  return (
    <div className="grid gap-2" data-ui="explanation-text">
      {paragraphs.map((paragraph, index) => {
        const parts: ReactNode[] = [];
        let offset = 0;
        while (offset < paragraph.length) {
          const match = keywords
            .map(term => ({ term, at: paragraph.indexOf(term, offset) }))
            .filter(item => item.at >= 0)
            .sort((a, b) => a.at - b.at)[0];
          if (!match) {
            parts.push(paragraph.slice(offset));
            break;
          }
          if (match.at > offset) parts.push(paragraph.slice(offset, match.at));
          parts.push(
            <strong key={match.at} className="font-semibold">
              {match.term}
            </strong>,
          );
          offset = match.at + match.term.length;
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {parts}
          </p>
        );
      })}
    </div>
  );
}

function Occurrences({
  document,
  focus,
  locale,
  onPlay,
  disabled,
}: {
  document: LearningDocument | FavoriteReaderDocument;
  focus: { expression: string; sourceCueIds: string[] };
  locale: UiLocale;
  onPlay: (occurrence: ExpressionOccurrence) => void;
  disabled: boolean;
}) {
  const copy = sentenceAnalysisCopy(locale);
  const [limit, setLimit] = useState(5);
  const matches = useMemo(
    () =>
      findExpressionOccurrences(document.cues, focus.expression, document.profile.targetLanguage),
    [document.cues, focus.expression, document.profile.targetLanguage],
  );
  const current = matches.findIndex(match =>
    match.cueIds.every(id => focus.sourceCueIds.includes(id)),
  );
  const others = matches.filter((_match, index) => index !== current);
  const cueMap = new Map(document.cues.map(cue => [cue.id, cue]));
  const range = document.analysisRange;
  return (
    <div className="grid min-w-0 gap-3" data-ui="expressionOccurrences">
      <p
        className="text-ui-source font-medium wrap-anywhere"
        lang={document.profile.targetLanguage}
      >
        {focus.expression} <Badge>{others.length}</Badge>
      </p>
      <p className="text-ui-meta leading-relaxed text-muted-foreground">
        {copy.scope}
        {range
          ? ": " + formatLoopTimestamp(range.startMs) + " – " + formatLoopTimestamp(range.endMs)
          : ": " + document.cues.length}
      </p>
      {!others.length && <p className="text-xs text-muted-foreground">{copy.noOccurrences}</p>}
      {others.slice(0, limit).map(match => (
        <div
          className="min-w-0 border-t border-border pt-2"
          key={match.spans.map(span => span.cueId + ":" + span.start).join("/")}
        >
          <div className="flex items-start gap-2">
            <p
              className="min-w-0 flex-1 text-ui-source wrap-anywhere"
              lang={document.profile.targetLanguage}
            >
              {match.cueIds.map(id => cueMap.get(id)?.originalText).join(" ")}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-auto min-h-8 shrink-0 px-2 text-ui-label tabular-nums"
              disabled={disabled || match.startMs === null || match.endMs === null}
              aria-label={
                copy.playOccurrence +
                " " +
                (match.startMs === null ? copy.untimed : formatLoopTimestamp(match.startMs))
              }
              onClick={() => onPlay(match)}
            >
              <Play className="size-3" aria-hidden="true" />
              {match.startMs === null ? copy.untimed : formatLoopTimestamp(match.startMs)}
            </Button>
          </div>
          <Accordion type="single" collapsible>
            <AccordionItem value="context" className="border-0">
              <AccordionTrigger className="py-2 text-ui-label">{copy.context}</AccordionTrigger>
              <AccordionContent className="pb-1">
                {match.contextCueIds.map(id => (
                  <p
                    key={id}
                    className="my-1 text-ui-source wrap-anywhere"
                    lang={document.profile.targetLanguage}
                  >
                    {cueMap.get(id)?.originalText}
                  </p>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      ))}
      {others.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setLimit(value => value + 5)}>
          {copy.more}
        </Button>
      )}
    </div>
  );
}

type Props = {
  document: LearningDocument | FavoriteReaderDocument;
  scene: LearningSceneV7;
  locale: UiLocale;
  playingCueId: string | null;
  selectedCueId?: string;
  disabled: boolean;
  playbackDisabled: boolean;
  translationVisible: boolean;
  onPlayCue: (id: string) => void;
  onPlayOccurrence: (occurrence: ExpressionOccurrence) => void;
  beforeSpeak?: (isCurrent: () => boolean) => Promise<void>;
  annotatedText: (text: string, segments?: SubtitlePronunciationSegment[]) => ReactNode;
  toolbarPlaybackAction?: ReactNode;
  toolbarActions?: ReactNode;
};

export function SentenceDialogue({
  document,
  scene: sourceScene,
  locale,
  playingCueId,
  selectedCueId,
  disabled,
  playbackDisabled,
  translationVisible,
  onPlayCue,
  onPlayOccurrence,
  beforeSpeak,
  annotatedText,
  toolbarPlaybackAction,
  toolbarActions,
}: Props) {
  const copy = sentenceAnalysisCopy(locale),
    reader = contextualReaderMessages[locale];
  const scene = useMemo(
    () => readerPresentation(document, sourceScene, translationVisible),
    [document, sourceScene, translationVisible],
  );
  const speechScope = document.id + ":" + scene.id;
  const speechLabels = speechCopy(locale);
  const dialogueRef = useRef<HTMLDivElement>(null);
  const selectionBeforePointerDown = useRef<Range | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const update = () =>
      dialogueRef.current?.style.setProperty(
        "--dialogue-toolbar-height",
        (toolbarRef.current?.getBoundingClientRect().height ?? 0) + "px",
      );
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    if (toolbarRef.current) observer?.observe(toolbarRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  const missingReadings =
    document.execution?.pronunciationDiagnostics?.filter(
      d => d.sceneId === scene.id && d.action === "omitted",
    ) ?? [];
  const readingWarning = (
    <p
      className="mt-1 text-ui-label text-muted-foreground leading-relaxed"
      data-ui="pronunciationMissing"
    >
      {pronunciationDiagnosticCopy(locale).missing}
    </p>
  );
  const groups = scene.groups.filter(g => g.analyses.length);
  const groupByCue = new Map(
    groups.flatMap(group => group.sourceCueIds.map(id => [id, group] as const)),
  );
  const blocks: { cueIds: string[]; group?: ReaderGroup }[] = [];
  for (const id of scene.cueIds) {
    const group = groupByCue.get(id);
    const previous = blocks.at(-1);
    // Keep intervening subtitles in source order when a group is discontinuous.
    if (group && previous?.group?.id === group.id) previous.cueIds.push(id);
    else blocks.push({ cueIds: [id], group });
  }
  const [selectedChunks, setSelectedChunks] = useState<
    Record<string, { analysisId: string; chunkId: string }>
  >({});
  const [expanded, setExpanded] = useState<Record<string, string[]>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [exampleTranslations, setExampleTranslations] = useState<Record<string, boolean>>({});
  const [exampleLimits, setExampleLimits] = useState<Record<string, number>>({});
  useEffect(() => {
    setSelectedChunks({});
    setExpanded({});
    setOpenGroups({});
    setExampleTranslations({});
    setExampleLimits({});
  }, [document.id, sourceScene.id]);
  const targetLanguage = document.profile.targetLanguage;
  const cueMap = new Map(document.cues.map(cue => [cue.id, cue]));
  const analysisId = (id: string) => "analysis-" + scene.id + "-" + id;
  function isSourceTextSelection(event: React.MouseEvent): boolean {
    const selection = window.getSelection();
    if (event.detail === 0 || !selection?.rangeCount || !selection.toString()) return false;
    const before = selectionBeforePointerDown.current;
    const after = selection.getRangeAt(0);
    // A retained speech selection is not a new drag-selection gesture.
    return (
      !before ||
      before.startContainer !== after.startContainer ||
      before.startOffset !== after.startOffset ||
      before.endContainer !== after.endContainer ||
      before.endOffset !== after.endOffset
    );
  }
  const allExpanded = groups.length > 0 && groups.every(group => openGroups[group.id]);
  function toggleGroup(group: ReaderGroup): void {
    if (disabled) return;
    window.getSelection()?.removeAllRanges();
    setOpenGroups(previous => ({ ...previous, [group.id]: !previous[group.id] }));
    setSelectedChunks(previous => {
      const next = { ...previous };
      delete next[group.id];
      return next;
    });
  }
  function selectChunk(group: ReaderGroup, analysis: ReaderAnalysis, chunkId: string): void {
    setOpenGroups(previous => ({ ...previous, [group.id]: true }));
    setSelectedChunks({
      [group.id]: { analysisId: analysis.id, chunkId },
    });
  }
  function renderAnalysis(analysis: ReaderAnalysis, group: ReaderGroup) {
    const notes = analysis.notes.filter(
      (note, i, all) => all.findIndex(n => n.id === note.id) === i,
    );
    const core = notes.filter(n => n.presentation === "core");
    const extended = notes.filter(n => n.presentation === "extended");
    const focusIndexes = analysis.focusIndexes;
    const focuses = focusIndexes.map(index => scene.focusItems[index]);
    const terms = focuses.map(focus => focus.expression);
    const noteTerms = (title: string) => [
      ...terms,
      ...[...title.matchAll(/[「『]([^」』]+)[」』]/gu)].map(match => match[1]),
    ];
    const occurrenceForms = focuses.flatMap(focus =>
      (focus.sourceForms ?? [{ text: focus.expression, cueIds: focus.sourceCueIds }]).filter(form =>
        findExpressionOccurrences(document.cues, form.text, document.profile.targetLanguage).some(
          match => !match.cueIds.every(id => form.cueIds.includes(id)),
        ),
      ),
    );
    const values = expanded[analysis.id] ?? [];
    const distinct = (text: string | undefined) => !!text?.trim();
    return (
      <section
        key={analysis.id}
        id={analysisId(analysis.id)}
        className="grid min-w-0 gap-4 text-ui-body wrap-anywhere [&>*:empty]:hidden"
        aria-label={copy.analysis}
        data-ui="inlineAnalysis"
      >
        {group.analyses.length > 1 && analysis.title && (
          <p
            className="text-ui-source font-medium text-muted-foreground"
            lang={targetLanguage}
            data-ui="analysis-source-title"
          >
            {analysis.title}
          </p>
        )}
        {!!analysis.basics?.length && (
          <div className="grid gap-2" data-ui="whole-meaning">
            <h4 className="text-xs font-semibold text-muted-foreground">{copy.wholeMeaning}</h4>
            {analysis.basics.map((basic, index) => (
              <div key={index} className="min-w-0">
                {distinct(basic.meaning) && <p className="font-medium">{basic.meaning}</p>}
                {distinct(basic.contextExplanation) && (
                  <div className="mt-1">
                    <ExplanationText text={basic.contextExplanation} terms={terms} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {focuses.map((focus, index) => (
          <div key={index} className="min-w-0">
            {distinct(focus.meaning) && <p className="font-medium">{focus.meaning}</p>}
            {distinct(focus.contextExplanation) && (
              <div className="mt-1">
                <ExplanationText text={focus.contextExplanation} terms={terms} />
              </div>
            )}
            {focus.wordNotes.map(
              (word, i) =>
                distinct(word.explanation) && (
                  <p key={i} className="mt-2">
                    <strong className="font-semibold" lang={targetLanguage}>
                      {word.surface}
                    </strong>{" "}
                    — {word.meaning}
                    <br />
                    {word.explanation}
                  </p>
                ),
            )}
          </div>
        ))}
        {core.length > 0 && (
          <div data-ui="coreExplanation" className="grid gap-3 text-ui-body wrap-anywhere">
            <h4 className="text-xs font-semibold text-muted-foreground">{copy.explanationNotes}</h4>
            {core.map(
              note =>
                distinct(note.explanation) && (
                  <div key={note.id} data-point-id={note.id}>
                    <p className="font-medium">{note.title}</p>
                    <div className="mt-1">
                      <ExplanationText text={note.explanation} terms={noteTerms(note.title)} />
                    </div>
                  </div>
                ),
            )}
          </div>
        )}
        <Accordion
          type="multiple"
          value={values}
          onValueChange={next => setExpanded(previous => ({ ...previous, [analysis.id]: next }))}
        >
          {extended.length > 0 && (
            <AccordionItem value="extended">
              <AccordionTrigger className="py-3 text-xs">{copy.moreExplanation}</AccordionTrigger>
              <AccordionContent className="pb-3 text-ui-body wrap-anywhere">
                {extended.map(note => (
                  <div
                    key={note.id}
                    data-point-id={note.id}
                    className="mb-3"
                    data-scope={note.chunkIds?.length ? "chunk" : "sentence"}
                  >
                    <strong className="font-semibold">{note.title}</strong>
                    <div className="mt-1">
                      <ExplanationText text={note.explanation} terms={noteTerms(note.title)} />
                    </div>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          )}
          {focuses.some(focus => focus.examples.length > 0) && (
            <AccordionItem value="examples">
              <AccordionTrigger className="py-2.5 text-xs">{copy.examples}</AccordionTrigger>
              <AccordionContent className="pb-3" data-ui="ai-examples">
                <p className="mb-3 text-ui-label text-muted-foreground leading-relaxed">
                  {reader.aiExamples}
                </p>
                <div className="grid gap-4">
                  {focusIndexes
                    .filter(i => scene.focusItems[i].examples.length > 0)
                    .map(focusIndex => (
                      <section
                        key={focusIndex}
                        aria-label={scene.focusItems[focusIndex].expression}
                        data-ui="example-group"
                        data-scope={
                          analysis.itemChunkIds[focusIndex]?.length ? "chunk" : "sentence"
                        }
                        className="min-w-0 overflow-hidden rounded-md border border-border"
                      >
                        <h5
                          className="border-b border-border bg-muted/50 px-3 py-2.5 text-ui-source font-semibold wrap-anywhere"
                          lang={targetLanguage}
                        >
                          {scene.focusItems[focusIndex].expression}
                        </h5>
                        <div className="divide-y divide-border">
                          {scene.focusItems[focusIndex].examples
                            .slice(0, exampleLimits[analysis.id + focusIndex] ?? 1)
                            .map((example, exampleIndex) => {
                              const key = analysis.id + ":" + focusIndex + ":" + exampleIndex;
                              return (
                                <div key={key} data-ui="example-dialogue" className="p-3">
                                  <div className="mb-3 flex items-start justify-between gap-2">
                                    <p className="min-w-0 flex-1 pt-1.5 text-ui-body text-muted-foreground wrap-anywhere">
                                      {example.situation}
                                    </p>
                                    <SpeechButton
                                      locale={locale}
                                      speechKey={key + ":dialogue"}
                                      scope={speechScope}
                                      text={example.dialogue.map(line => line.text).join("\n")}
                                      segments={example.dialogue.map(line => line.text)}
                                      language={targetLanguage}
                                      beforeSpeak={beforeSpeak}
                                      disabled={disabled}
                                      label={speechLabels.dialogue}
                                      size="icon"
                                      className="size-8 shrink-0"
                                    />
                                  </div>
                                  {example.dialogue.map((line, index) => (
                                    <div key={index} className="mb-2">
                                      <div className="flex items-start gap-1">
                                        <p
                                          className="min-w-0 flex-1 text-ui-source wrap-anywhere"
                                          lang={targetLanguage}
                                        >
                                          {annotatedText(line.text, line.pronunciation)}
                                        </p>
                                        <SpeechButton
                                          locale={locale}
                                          speechKey={key + ":line:" + index}
                                          scope={speechScope}
                                          text={line.text}
                                          language={targetLanguage}
                                          beforeSpeak={beforeSpeak}
                                          disabled={disabled}
                                          label={speechLabels.play + " " + (index + 1)}
                                        />
                                      </div>
                                      {missingReadings.some(
                                        d =>
                                          d.itemId === scene.focusItems[focusIndex].id &&
                                          d.exampleIndex === exampleIndex &&
                                          d.lineIndex === index,
                                      ) && readingWarning}
                                      {exampleTranslations[key] && (
                                        <p className="mt-1 text-ui-body text-muted-foreground">
                                          {line.translation}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="-ml-2 text-xs"
                                    aria-pressed={!!exampleTranslations[key]}
                                    onClick={() =>
                                      setExampleTranslations(previous => ({
                                        ...previous,
                                        [key]: !previous[key],
                                      }))
                                    }
                                  >
                                    {exampleTranslations[key]
                                      ? reader.hideTranslation
                                      : reader.translation}
                                  </Button>
                                </div>
                              );
                            })}
                        </div>
                        {scene.focusItems[focusIndex].examples.length >
                          (exampleLimits[analysis.id + focusIndex] ?? 1) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mx-1 mb-1 text-xs"
                            onClick={() =>
                              setExampleLimits(previous => ({
                                ...previous,
                                [analysis.id + focusIndex]:
                                  scene.focusItems[focusIndex].examples.length,
                              }))
                            }
                          >
                            {copy.more}
                          </Button>
                        )}
                      </section>
                    ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
          {occurrenceForms.length > 0 && (
            <AccordionItem value="occurrences">
              <AccordionTrigger className="py-3 text-xs">{copy.occurrences}</AccordionTrigger>
              <AccordionContent className="pb-3">
                {occurrenceForms.map((form, i) => (
                  <Occurrences
                    key={i}
                    document={document}
                    focus={{ expression: form.text, sourceCueIds: form.cueIds }}
                    locale={locale}
                    onPlay={onPlayOccurrence}
                    disabled={playbackDisabled}
                  />
                ))}
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </section>
    );
  }

  function renderSelectedChunk(group: ReaderGroup) {
    const selection = selectedChunks[group.id];
    const analysis = group.analyses.find(unit => unit.id === selection?.analysisId);
    const chunk = analysis?.chunks?.find(item => item.id === selection?.chunkId);
    const text = chunk?.spans
      .map(span => cueMap.get(span.cueId)?.originalText.slice(span.start, span.end))
      .join(" ");
    return (
      <div
        id={analysisId(group.id) + ":selection"}
        aria-live="polite"
        aria-atomic="true"
        className="empty:hidden"
      >
        {analysis && chunk && text && (
          <section
            aria-labelledby={analysisId(group.id) + ":selection-heading"}
            data-ui="selectedChunkMeaning"
            className="min-w-0 border-l-2 border-primary bg-muted/50 px-3 pb-3 text-ui-body wrap-anywhere"
          >
            <h4
              id={analysisId(group.id) + ":selection-heading"}
              className="pt-3 text-xs font-semibold"
            >
              {copy.selectedAnalysis}
            </h4>
            <div className="mb-2 flex min-w-0 items-start gap-1">
              <p
                lang={targetLanguage}
                className="min-w-0 flex-1 text-ui-source text-muted-foreground"
              >
                {text}
              </p>
              <div className="flex size-8 shrink-0 items-center justify-center">
                <SpeechButton
                  locale={locale}
                  speechKey={analysis.id + ":" + chunk.id}
                  scope={speechScope}
                  language={targetLanguage}
                  text={text}
                  beforeSpeak={beforeSpeak}
                  disabled={disabled}
                  label={speechLabels.chunk}
                  size="icon"
                  className="size-8 shrink-0 rounded-full p-0 [&_svg]:size-3.5"
                />
              </div>
            </div>
            {chunk.meaning && <p className="font-medium">{chunk.meaning}</p>}
            {chunk.role && <p className="mt-2">{chunk.role}</p>}
          </section>
        )}
      </div>
    );
  }

  return (
    <div
      ref={dialogueRef}
      role="group"
      aria-label={reader.dialogue}
      className="@container"
      onPointerDownCapture={() => {
        const selection = window.getSelection();
        selectionBeforePointerDown.current = selection?.rangeCount
          ? selection.getRangeAt(0).cloneRange()
          : null;
      }}
    >
      <div
        ref={toolbarRef}
        className="sticky -top-3 z-10 -mx-3 mb-2 grid gap-1 border-b border-border bg-card px-3 py-2 [@media(max-height:400px)]:static"
        data-ui="dialogue-toolbar"
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="min-w-0 text-xs font-semibold">{reader.dialogue}</h3>
          {toolbarPlaybackAction}
        </div>
        <div className="-ml-2 flex min-w-0 flex-wrap items-center gap-1">
          {groups.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-8 text-xs"
              data-ui="analysis-toggle-all"
              disabled={disabled}
              onClick={() => {
                window.getSelection()?.removeAllRanges();
                setOpenGroups(
                  allExpanded ? {} : Object.fromEntries(groups.map(group => [group.id, true])),
                );
                if (allExpanded) setSelectedChunks({});
              }}
            >
              {allExpanded ? copy.collapseAll : copy.expandAll}
            </Button>
          )}
          {toolbarActions}
        </div>
      </div>
      <div className="grid gap-2" data-ui="dialogue-utterances">
        {blocks.map(({ cueIds, group }) => {
          const firstId = cueIds[0];
          const singleCueGroup = group?.sourceCueIds.length === 1;
          const numbers = group?.sourceCueIds.map(id => scene.cueIds.indexOf(id) + 1) ?? [];
          const contiguous = numbers.every(
            (number, index) => index === 0 || number === numbers[index - 1] + 1,
          );
          const range = (
            contiguous
              ? [numbers[0], numbers.at(-1)].filter(
                  (number, index, values) => index === 0 || number !== values[0],
                )
              : numbers
          )
            .map(number => String(number).padStart(2, "0"))
            .join(contiguous ? "–" : ", ");
          return (
            <div
              key={firstId}
              data-source-group={group?.id}
              data-ui="sourceUtterance"
              className={
                "grid min-w-0 grid-cols-[20px_minmax(0,1fr)_auto] gap-x-1 gap-y-1 border-b border-border px-1 py-4 last:border-b-0 scroll-mt-[var(--dialogue-toolbar-height)] [&_ruby]:[ruby-align:start]"
              }
            >
              {group?.sourceCueIds[0] === firstId && (
                <div
                  data-ui="analysis-source-header"
                  className="col-span-3 flex min-h-8 min-w-0 items-center justify-between gap-2"
                >
                  <Button
                    variant="ghost"
                    className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-6 text-ui-label tabular-nums text-muted-foreground focus-visible:ring-inset focus-visible:ring-offset-0"
                    data-ui="analysis-toggle"
                    aria-label={
                      (openGroups[group.id] ? copy.hideAnalysis : copy.viewAnalysis) + " " + range
                    }
                    aria-expanded={!!openGroups[group.id]}
                    aria-controls={analysisId(group.id) + ":content"}
                    disabled={disabled}
                    onClick={() => toggleGroup(group)}
                  >
                    <span data-ui="analysis-range" id={analysisId(group.id) + ":range"}>
                      {range}
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={"size-3.5 " + (openGroups[group.id] ? "rotate-180" : "")}
                    />
                  </Button>
                  <div className="shrink-0 empty:hidden">
                    <SpeechButton
                      size="icon"
                      className="size-8 [&_svg]:size-3.5"
                      locale={locale}
                      speechKey={firstId + ":sentence"}
                      scope={speechScope}
                      language={targetLanguage}
                      text={subtitleSpeechText(
                        group.sourceCueIds.map(id => cueMap.get(id)?.originalText ?? ""),
                      )}
                      beforeSpeak={beforeSpeak}
                      disabled={disabled}
                      label={speechLabels.sentence}
                      aria-describedby={analysisId(group.id) + ":range"}
                    />
                  </div>
                </div>
              )}
              {cueIds.map(id => {
                const index = scene.cueIds.indexOf(id);
                const cue = cueMap.get(id);
                if (!cue) return null;
                const segments = subtitlePronunciationSegments(
                  cue,
                  scene.pronunciations?.find(item => item.cueId === id)?.segments,
                );
                const fragments = (group?.analyses ?? [])
                  .flatMap(unit =>
                    (unit.chunks ?? []).flatMap(chunk =>
                      chunk.spans
                        .filter(span => span.cueId === id)
                        .map(span => ({ unit, chunk, span })),
                    ),
                  )
                  .sort((a, b) => a.span.start - b.span.start);
                const pieces: ReactNode[] = [];
                let offset = 0;
                for (const { unit, chunk, span } of fragments) {
                  if (span.end <= offset) continue;
                  if (span.start > offset)
                    pieces.push(
                      <React.Fragment key={"gap-" + offset}>
                        {annotatedText(
                          cue.originalText.slice(offset, span.start),
                          pronunciationSlice(segments, cue.originalText, offset, span.start),
                        )}
                      </React.Fragment>,
                    );
                  const start = Math.max(offset, span.start);
                  pieces.push(
                    <ToggleGroupItem
                      key={`${unit.id}:${chunk.id}:${start}:${span.end}`}
                      data-ui="source-chunk-hover"
                      value={unit.id + ":" + chunk.id}
                      aria-label={cue.originalText.slice(start, span.end)}
                      aria-controls={analysisId(group!.id) + ":selection"}
                      disabled={disabled}
                      onClick={event => {
                        if (isSourceTextSelection(event)) event.preventDefault();
                        else window.getSelection()?.removeAllRanges();
                      }}
                      className="inline h-auto min-h-8 min-w-0 max-w-full rounded-sm p-0 text-left text-ui-source whitespace-normal underline decoration-border underline-offset-4 hover:bg-muted/70 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:decoration-primary data-[state=on]:decoration-2 motion-reduce:transition-none [box-decoration-break:clone]"
                    >
                      {annotatedText(
                        cue.originalText.slice(start, span.end),
                        pronunciationSlice(segments, cue.originalText, start, span.end),
                      )}
                    </ToggleGroupItem>,
                  );
                  offset = span.end;
                }
                if (offset < cue.originalText.length)
                  pieces.push(
                    <React.Fragment key={"gap-" + offset}>
                      {annotatedText(
                        cue.originalText.slice(offset),
                        pronunciationSlice(
                          segments,
                          cue.originalText,
                          offset,
                          cue.originalText.length,
                        ),
                      )}
                    </React.Fragment>,
                  );
                const translation = scene.translations.find(item => item.cueId === id);
                return (
                  <React.Fragment key={id}>
                    <div
                      className={
                        "col-span-3 grid min-w-0 grid-cols-subgrid items-start gap-x-1 rounded-md py-1 scroll-mt-[var(--dialogue-toolbar-height)] " +
                        (playingCueId === id ? "bg-accent text-accent-foreground" : "")
                      }
                      data-ui="sourceSentence"
                      data-source-cue={id}
                      aria-current={playingCueId === id ? "true" : undefined}
                      onClick={event => {
                        if (!group || disabled) return;
                        if (
                          event.target instanceof Element &&
                          event.target.closest(
                            "button, a, input, select, textarea, [role=button], [role=radio]",
                          )
                        )
                          return;
                        if (isSourceTextSelection(event)) return;
                        toggleGroup(group);
                      }}
                    >
                      <span
                        data-ui="sentence-number"
                        aria-hidden={group?.sourceCueIds.length === 1 ? true : undefined}
                        className="flex h-8 items-center text-ui-meta tabular-nums text-muted-foreground"
                      >
                        {group?.sourceCueIds.length === 1
                          ? null
                          : String(index + 1).padStart(2, "0")}
                      </span>
                      <div
                        className={"min-w-0 " + (group && !disabled ? "cursor-pointer" : "")}
                        data-ui="sentence-text"
                      >
                        {fragments.length > 0 && group ? (
                          <ToggleGroup
                            type="single"
                            value={
                              selectedChunks[group.id]
                                ? selectedChunks[group.id].analysisId +
                                  ":" +
                                  selectedChunks[group.id].chunkId
                                : ""
                            }
                            onValueChange={value => {
                              const fragment = fragments.find(
                                item => item.unit.id + ":" + item.chunk.id === value,
                              );
                              if (fragment) selectChunk(group, fragment.unit, fragment.chunk.id);
                              else setSelectedChunks({});
                            }}
                            className="block min-h-8 min-w-0 text-left text-ui-source wrap-anywhere"
                            lang={targetLanguage}
                            aria-label={copy.label("chunks")}
                          >
                            {pieces}
                          </ToggleGroup>
                        ) : (
                          <div
                            className="block min-h-8 text-left text-ui-source wrap-anywhere"
                            lang={targetLanguage}
                          >
                            {pieces}
                          </div>
                        )}
                        {missingReadings.some(d => d.cueId === id) && readingWarning}
                        {translationVisible && translation && (
                          <p className="mt-1 text-ui-body text-muted-foreground">
                            {translation.text}
                          </p>
                        )}
                      </div>
                      <div
                        className={
                          "grid shrink-0 items-start gap-x-0.5 " +
                          (group ? "grid-cols-[32px]" : "grid-cols-[32px_32px]")
                        }
                        data-ui="sentence-actions"
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          className={
                            "row-start-1 size-8 [&_svg]:size-3.5 " +
                            (group ? "col-start-1" : "col-start-2")
                          }
                          aria-label={reader.playCue + " " + (index + 1)}
                          data-ui="cue-play"
                          aria-pressed={selectedCueId === id}
                          disabled={playbackDisabled}
                          onClick={() => onPlayCue(id)}
                        >
                          <Play aria-hidden="true" />
                        </Button>
                        {!group && (
                          <div className="col-start-1 row-start-1">
                            <SpeechButton
                              locale={locale}
                              speechKey={id + ":sentence"}
                              scope={speechScope}
                              language={targetLanguage}
                              text={cue.originalText}
                              beforeSpeak={beforeSpeak}
                              disabled={disabled}
                              label={speechLabels.play + " " + (index + 1)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    {group?.anchorCueId === id && (
                      <div
                        id={analysisId(group.id) + ":content"}
                        data-ui="analysis-content"
                        hidden={!openGroups[group.id]}
                        className={
                          "col-start-2 col-span-2 min-w-0 gap-5 pt-3 " +
                          (openGroups[group.id] ? "grid" : "hidden")
                        }
                      >
                        {group.analyses.some(analysis => analysis.chunks?.length) && (
                          <p
                            className="text-xs leading-relaxed text-muted-foreground"
                            data-ui="chunk-hint"
                          >
                            {copy.chunkHint}
                          </p>
                        )}
                        {renderSelectedChunk(group)}
                        <div
                          className="grid min-w-0 gap-5"
                          data-ui="analysis-group"
                          data-source-cue={group.anchorCueId}
                        >
                          {group.analyses.map(unit => renderAnalysis(unit, group))}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
