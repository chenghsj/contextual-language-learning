import type { LearningLanguage } from "./languages";
import type { SubtitleCue } from "./schema";
import type { SourceSpan } from "./explanations";

export type ExpressionOccurrence = {
  spans: SourceSpan[];
  cueIds: string[];
  contextCueIds: string[];
  startMs: number | null;
  endMs: number | null;
};
type MappedChar = { char: string; span?: SourceSpan };
function normalized(text: string, cueId?: string): MappedChar[] {
  const result: MappedChar[] = [];
  let offset = 0;
  for (const raw of text) {
    const start = offset;
    offset += raw.length;
    const char = /\s/u.test(raw)
      ? " "
      : raw.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').toLowerCase();
    if (char === " " && result.at(-1)?.char === " ") {
      if (cueId && result.at(-1)?.span) result[result.length - 1].span!.end = offset;
      continue;
    }
    for (const part of char)
      result.push({ char: part, span: cueId ? { cueId, start, end: offset } : undefined });
  }
  return result;
}

/** A local literal concordance; normalization never replaces stored subtitle text. */
export function findExpressionOccurrences(
  cues: readonly SubtitleCue[],
  expression: string,
  language: LearningLanguage,
): ExpressionOccurrence[] {
  const needle = normalized(expression.trim())
    .map(item => item.char)
    .join("");
  if (!needle) return [];
  const source: MappedChar[] = [];
  const compact =
    language === "ja" || language === "th" || language === "zh-TW" || language === "zh-CN";
  cues.forEach((cue, index) => {
    const previous = cues[index - 1];
    if (previous) {
      const disconnected =
        previous.endMs !== null && cue.startMs !== null && cue.startMs - previous.endMs > 2000;
      source.push({ char: disconnected ? "\u0000" : compact ? "" : " " });
    }
    source.push(...normalized(cue.originalText, cue.id));
  });
  // Flatten to code units because indexOf returns UTF-16 offsets.
  const chars: MappedChar[] = [];
  for (const item of source) {
    if (item.char === " " && chars.at(-1)?.char === " ") continue;
    for (const char of item.char.split("")) chars.push({ ...item, char });
  }
  const haystack = chars.map(item => item.char).join("");
  const word = (char: string | undefined) => !!char && /[\p{L}\p{N}\p{M}_]/u.test(char);
  const bounded = !compact;
  const result: ExpressionOccurrence[] = [];
  let start = haystack.indexOf(needle);
  while (start !== -1) {
    const end = start + needle.length;
    if (
      (!bounded || !word(needle[0]) || !word(haystack[start - 1])) &&
      (!bounded || !word(needle.at(-1)) || !word(haystack[end]))
    ) {
      const spans: SourceSpan[] = [];
      for (const item of chars.slice(start, end)) {
        if (!item.span) continue;
        const last = spans.at(-1);
        if (last?.cueId === item.span.cueId) last.end = item.span.end;
        else spans.push({ ...item.span });
      }
      const cueIds = spans.map(span => span.cueId);
      if (cueIds.length && cueIds.length <= 10) {
        const first = cues.findIndex(cue => cue.id === cueIds[0]);
        const last = first + cueIds.length - 1;
        result.push({
          spans,
          cueIds,
          contextCueIds: cues.slice(Math.max(0, first - 1), last + 2).map(cue => cue.id),
          startMs: cues[first].startMs,
          endMs: cues[last].endMs,
        });
      }
    }
    start = haystack.indexOf(needle, start + 1);
  }
  return result;
}
