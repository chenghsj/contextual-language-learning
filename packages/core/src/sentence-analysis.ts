import type { SubtitleCue } from "./schema";
import type { SentenceChunk, SourceSpan } from "./explanations";

function spanOrder(a: SourceSpan, b: SourceSpan, ids: string[]) {
  return ids.indexOf(a.cueId) - ids.indexOf(b.cueId) || a.start - b.start;
}

/** Offsets are UTF-16 indices into the immutable original cue, never normalized text. */
export function alignedChunks(
  chunks: SentenceChunk[],
  ids: string[],
  cues: readonly SubtitleCue[],
): boolean {
  const byId = new Map(cues.map(cue => [cue.id, cue]));
  const seen = new Set<string>();
  let previous: SourceSpan | undefined;
  for (const chunk of chunks) {
    if (seen.has(chunk.id)) return false;
    if (new Set(chunk.spans.map(span => span.cueId)).size !== chunk.spans.length) return false;
    seen.add(chunk.id);
    for (const span of chunk.spans) {
      const text = byId.get(span.cueId)?.originalText;
      if (
        !ids.includes(span.cueId) ||
        text === undefined ||
        span.start >= span.end ||
        span.end > text.length
      )
        return false;
      // A boundary cannot bisect a surrogate pair.
      for (const boundary of [span.start, span.end]) {
        const code = text.charCodeAt(boundary);
        if (code >= 0xdc00 && code <= 0xdfff) return false;
      }
      if (
        previous &&
        (spanOrder(previous, span, ids) > 0 ||
          (previous.cueId === span.cueId && previous.end > span.start))
      )
        return false;
      previous = span;
    }
  }
  return true;
}

/** Slice annotation segments along a source span while retaining exact visible source text. */
export function pronunciationSlice<T extends { text: string; reading?: string }>(
  segments: T[] | undefined,
  text: string,
  start: number,
  end: number,
): T[] | undefined {
  if (!segments || segments.map(segment => segment.text).join("") !== text) return undefined;
  let offset = 0;
  const result: T[] = [];
  for (const segment of segments) {
    const from = Math.max(start, offset),
      to = Math.min(end, offset + segment.text.length);
    if (from < to)
      result.push({
        ...segment,
        text: text.slice(from, to),
        reading:
          from === offset && to === offset + segment.text.length ? segment.reading : undefined,
      });
    offset += segment.text.length;
  }
  return result;
}
