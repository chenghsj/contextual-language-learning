import type { SourceSpan } from "./explanations";
import type { SourceUtterance, SubtitleCue } from "./schema";

/** UTF-16 offsets must also be extended grapheme boundaries. */
export function graphemeBoundaries(text: string): Set<number> {
  return new Set([
    0,
    text.length,
    ...Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
      s => s.index,
    ),
  ]);
}
export function spanCueIds(spans: readonly SourceSpan[]): string[] {
  return [...new Set(spans.map(s => s.cueId))];
}
export function sourceSpanText(
  spans: readonly SourceSpan[],
  cues: readonly SubtitleCue[],
  separator = "",
): string {
  return spans
    .map(s => {
      const cue = cues.find(c => c.id === s.cueId);
      if (!cue) throw new Error("Unknown source span cue");
      return cue.originalText.slice(s.start, s.end);
    })
    .join(separator);
}
export function assertContainedSpans(spans: readonly SourceSpan[], parents: readonly SourceSpan[]) {
  for (const span of spans) {
    let end = span.start;
    for (const parent of parents
      .filter(p => p.cueId === span.cueId)
      .sort((a, b) => a.start - b.start)) {
      if (parent.start > end) break;
      if (parent.end > end) end = parent.end;
      if (end >= span.end) break;
    }
    if (end < span.end) throw new Error("invalid_span: outside associated teaching unit");
  }
}
/** All selected characters, including spaces/punctuation, belong to exactly one ordered unit. */
export function validateUnitCoverage(
  units: readonly SourceUtterance[],
  cueIds: readonly string[],
  cues: readonly SubtitleCue[],
) {
  let index = 0,
    offset = 0;
  for (const unit of units) {
    if (
      !unit.sourceSpans.length ||
      JSON.stringify(unit.cueIds) !== JSON.stringify(spanCueIds(unit.sourceSpans))
    )
      throw new Error("invalid_source_reference: cue IDs must derive from unit sourceSpans");
    for (const span of unit.sourceSpans) {
      const cue = cues.find(c => c.id === cueIds[index]);
      if (
        !cue ||
        span.cueId !== cue.id ||
        span.start !== offset ||
        span.end <= span.start ||
        span.end > cue.originalText.length
      )
        throw new Error(
          "invalid_source_reference: unit coverage has gap, overlap or wrong source order",
        );
      const boundaries = graphemeBoundaries(cue.originalText);
      if (!boundaries.has(span.start) || !boundaries.has(span.end))
        throw new Error("invalid_span: split Unicode grapheme cluster");
      offset = span.end;
      if (offset === cue.originalText.length) {
        index++;
        offset = 0;
      }
    }
  }
  if (index !== cueIds.length || offset !== 0)
    throw new Error("invalid_source_reference: incomplete unit coverage");
}
/** Connected units sharing a source cue are indivisible translation/reading batches. */
export function atomicUnitGroups(units: readonly SourceUtterance[]): string[][] {
  const groups: { ids: string[]; cues: Set<string> }[] = [];
  for (const unit of units) {
    const first = groups.findIndex(g => unit.cueIds.some(c => g.cues.has(c)));
    if (first < 0) groups.push({ ids: [unit.id], cues: new Set(unit.cueIds) });
    else {
      const suffix = groups.splice(first);
      groups.push({
        ids: [...suffix.flatMap(g => g.ids), unit.id],
        cues: new Set([...suffix.flatMap(g => [...g.cues]), ...unit.cueIds]),
      });
    }
  }
  return groups.map(g => g.ids);
}
export function assertAtomicUnitSplit(
  groups: readonly string[][],
  units: readonly SourceUtterance[],
) {
  const owners = new Map<string, number>();
  groups.forEach((ids, i) =>
    ids.forEach(id =>
      units
        .find(u => u.id === id)
        ?.cueIds.forEach(c => {
          if (owners.has(c) && owners.get(c) !== i)
            throw new Error("Shared subtitle units cannot be split across teaching batches");
          owners.set(c, i);
        }),
    ),
  );
}
