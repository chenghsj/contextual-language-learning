import type { PronunciationSegment, SubtitleCue, SubtitleRuby } from "./schema";
import { pronunciationSlice } from "./sentence-analysis";

function decodeText(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
    lrm: "\u200e",
    rlm: "\u200f",
  };
  return text.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi,
    (entity, name: string) => {
      if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? entity;
      const code =
        name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    },
  );
}

/** Parse cue markup as data in both Node and the browser; never render imported HTML. */
export function parseSubtitleMarkup(input: string): Pick<SubtitleCue, "originalText" | "ruby"> {
  let source = "";
  const ruby: SubtitleRuby[] = [];
  const frames: {
    start: number;
    reading: string;
    rt: boolean;
    rp: boolean;
    position: "over" | "under";
  }[] = [];
  let orphanAnnotation: string | undefined;
  function finishReading() {
    const frame = frames.at(-1);
    if (!frame?.rt) return;
    const reading = frame.reading.replace(/\s+/g, " ").trim();
    if (frame.start < source.length && reading && reading.length <= 200)
      ruby.push({ start: frame.start, end: source.length, reading, position: frame.position });
    frame.start = source.length;
    frame.rt = false;
    frame.reading = "";
  }
  for (const token of input.match(/<[^>]*>|[^<]+|</g) ?? []) {
    if (token.startsWith("<") && token.endsWith(">")) {
      const tag = token.match(/^<\s*(\/?)\s*([\w:-]+)/);
      if (!tag) continue;
      const closing = !!tag[1],
        name = tag[2].toLowerCase();
      if (name === "ruby") {
        if (closing) {
          finishReading();
          frames.pop();
        } else
          frames.push({
            start: source.length,
            reading: "",
            rt: false,
            rp: false,
            position:
              /^<ruby(?:\.[\w-]+)*\.under(?:[\s>])/i.test(token) ||
              /ruby-position\s*:\s*under\b/i.test(token)
                ? "under"
                : "over",
          });
      } else if (name === "rt" || name === "rp") {
        const frame = frames.at(-1);
        if (!frame) {
          orphanAnnotation = closing ? undefined : name;
          continue;
        }
        if (name === "rt") {
          finishReading();
          frame.rt = !closing;
          frame.rp = false;
        } else frame.rp = !closing;
      } else if (
        name === "br" &&
        !closing &&
        !frames.at(-1)?.rt &&
        !frames.at(-1)?.rp &&
        !orphanAnnotation
      )
        source += " ";
      continue;
    }
    const frame = frames.at(-1);
    if (orphanAnnotation || frame?.rp) continue;
    if (frame?.rt) frame.reading += decodeText(token);
    else source += decodeText(token);
  }
  while (frames.length) {
    finishReading();
    frames.pop();
  }
  const originalText = source.replace(/\s+/g, " ").trim();
  const offset = (index: number) => source.slice(0, index).replace(/\s+/g, " ").trimStart().length;
  const annotations = ruby
    .flatMap(item => {
      let start = item.start,
        end = item.end;
      while (start < end && /\s/.test(source[start])) start++;
      while (end > start && /\s/.test(source[end - 1])) end--;
      return start < end ? [{ ...item, start: offset(start), end: offset(end) }] : [];
    })
    .sort((a, b) => a.start - b.start)
    .filter((item, index, items) => index === 0 || item.start >= items[index - 1].end)
    .slice(0, 100);
  return { originalText, ...(annotations.length ? { ruby: annotations } : {}) };
}

export type SubtitlePronunciationSegment = PronunciationSegment & {
  rubyPosition?: "over" | "under";
};

/** Re-encode cue data so timing edits and draft persistence retain untouched annotations. */
export function serializeSubtitleMarkup(cue: SubtitleCue): string {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let offset = 0,
    markup = "";
  for (const item of cue.ruby ?? []) {
    markup += escape(cue.originalText.slice(offset, item.start));
    markup += `<ruby.${item.position}>${escape(cue.originalText.slice(item.start, item.end))}<rt>${escape(item.reading)}</rt></ruby>`;
    offset = item.end;
  }
  return markup + escape(cue.originalText.slice(offset));
}

/** Source annotations override model readings only on their exact base ranges. */
export function subtitlePronunciationSegments(
  cue: SubtitleCue,
  generated?: PronunciationSegment[],
): SubtitlePronunciationSegment[] | undefined {
  if (!cue.ruby?.length) return generated;
  const segments: SubtitlePronunciationSegment[] = [];
  let offset = 0;
  function gap(end: number) {
    if (offset < end)
      segments.push(
        ...(pronunciationSlice(generated, cue.originalText, offset, end) ?? [
          { text: cue.originalText.slice(offset, end) },
        ]),
      );
  }
  for (const item of cue.ruby) {
    if (item.start < offset || item.end <= item.start || item.end > cue.originalText.length)
      continue;
    gap(item.start);
    segments.push({
      text: cue.originalText.slice(item.start, item.end),
      reading: item.reading,
      rubyPosition: item.position,
    });
    offset = item.end;
  }
  gap(cue.originalText.length);
  return segments;
}
