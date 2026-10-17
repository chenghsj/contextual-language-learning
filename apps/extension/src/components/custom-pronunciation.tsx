import React from "react";
import { validPronunciationReading, type LearningLanguage } from "@contextual/core";
import { displayReading, type PronunciationMode } from "./pronunciation";

/** Only explicit readings from the document are converted; original Markdown stays intact. */
export function annotatedMarkdownText(
  children: React.ReactNode,
  language: LearningLanguage,
  mode: PronunciationMode,
): React.ReactNode {
  return React.Children.map(children, child => {
    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      if (["code", "pre", "a"].includes(String(child.type))) return child;
      return React.cloneElement(
        child,
        {},
        annotatedMarkdownText(child.props.children, language, mode),
      );
    }
    if (typeof child !== "string") return child;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    const pairs =
      /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}々ー]+)[（(]([^（）()\n]{1,160})[）)]/gu;
    for (const match of child.matchAll(pairs)) {
      if (!validPronunciationReading(match[2], language)) continue;
      const reading = displayReading(language, mode, match[2]);
      // Unsupported conversions retain the supplied reading instead of silently losing it.
      if (mode !== "off" && !reading) continue;
      parts.push(child.slice(cursor, match.index));
      parts.push(
        mode === "off" ? (
          match[1]
        ) : (
          <ruby key={match.index} lang={language} data-reading={match[2]}>
            {match[1]}
            <rp>（</rp>
            <rt>{reading}</rt>
            <rp>）</rp>
          </ruby>
        ),
      );
      cursor = match.index + match[0].length;
    }
    return cursor ? [...parts, child.slice(cursor)] : child;
  });
}
