import { Disclosure } from "./disclosure";
import React, { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ContextualScene, PronunciationSegment } from "@immersive/core";
import { contextualText, type ContextualReaderCopy } from "../i18n/contextual-reader";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

/** Context and examples are independent of video playback state. */
export function SceneFocusItems({ scene, targetLanguage, copy, annotatedText }: {
  scene: ContextualScene; targetLanguage: string; copy: ContextualReaderCopy;
  annotatedText: (text: string, segments?: PronunciationSegment[]) => ReactNode;
}) {
  const [expandedExamples, setExpandedExamples] = useState<Record<string, boolean>>({});
  const [exampleTranslations, setExampleTranslations] = useState<Record<string, boolean>>({});
  return (
      <div className="mt-4 grid gap-4">
        {scene.focusItems.map((focus, focusIndex) => {
          const key = scene.id + ":" + focusIndex;
          const more = expandedExamples[key] ?? false;
          const visibleExamples = more ? focus.examples : focus.examples.slice(0, 1);
          return <section className="min-w-0 border-t border-border pt-3 [&>h3]:text-sm [&>h3]:wrap-anywhere" key={key}>
            <span className="mb-[7px] block text-[11px] font-[650] text-muted-foreground">{copy.focus} {focusIndex + 1} / {scene.focusItems.length}</span>
            <h3 lang={targetLanguage}>{focus.expression}</h3>
            <p className="mt-1 mb-2 text-xs">{focus.meaning}</p>
            <Card className="p-2.5 text-xs leading-[1.65] [&>p]:mt-[5px] [&>p]:mb-0">
              <strong>{copy.context}</strong>
              <p>{focus.contextExplanation}</p>
            </Card>
            {focus.wordNotes.length > 0 && <Disclosure className="my-2 min-w-0" title={<>{copy.words}</>}>
              {focus.wordNotes.map((word, index) =>
                <div className="pt-[11px] text-xs [&:not(:first-of-type)]:mt-[10px] [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:border-border [&>strong]:mr-2 [&>span]:text-muted-foreground [&>p]:mt-[5px] [&>p]:mb-0" key={index}>
                  <strong lang={targetLanguage}>{word.surface}</strong>
                  <span>{word.meaning}</span>
                  <p>{word.explanation}</p>
                </div>)}
            </Disclosure>}
            <div className="mt-3 min-w-0 [&_[data-ui=hint]]:mt-1 [&_[data-ui=hint]]:mb-[10px]">
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
                      <p lang={targetLanguage}>{annotatedText(line.text, line.pronunciation)}</p>
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
  );
}
