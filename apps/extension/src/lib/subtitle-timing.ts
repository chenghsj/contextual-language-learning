import type { SubtitleCue } from "@contextual/core";

export type TimingCorrection = { id: string; startMs: number; endMs: number };
export type TimingAnchor = { subtitleMs: number; audioMs: number };
export const SUBTITLE_TIMING_ALGORITHM_VERSION = 3;

function validRange(startMs: number, endMs: number, durationMs?: number) {
  return (
    Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    startMs >= 0 &&
    endMs > startMs &&
    (durationMs === undefined || (Number.isFinite(durationMs) && endMs <= durationMs))
  );
}

/** Fail the entire transformation instead of silently clipping or dropping a caption. */
export function transformSubtitleTiming(
  cues: readonly SubtitleCue[],
  options: { offsetMs: number } | { anchors: readonly [TimingAnchor, TimingAnchor] },
  durationMs?: number,
): TimingCorrection[] {
  let scale = 1;
  let offset: number;
  if ("anchors" in options) {
    const [a, b] = options.anchors;
    if (
      ![a.subtitleMs, a.audioMs, b.subtitleMs, b.audioMs].every(
        n => Number.isSafeInteger(n) && n >= 0,
      ) ||
      b.subtitleMs <= a.subtitleMs ||
      b.audioMs <= a.audioMs
    )
      throw new Error("INVALID_TIMING");
    scale = (b.audioMs - a.audioMs) / (b.subtitleMs - a.subtitleMs);
    offset = a.audioMs - a.subtitleMs * scale;
  } else {
    offset = options.offsetMs;
    if (!Number.isSafeInteger(offset)) throw new Error("INVALID_TIMING");
  }
  return cues.flatMap(cue => {
    if (cue.startMs === null || cue.endMs === null) return [];
    const startMs = Math.round(cue.startMs * scale + offset);
    const endMs = Math.round(cue.endMs * scale + offset);
    if (!validRange(startMs, endMs, durationMs)) throw new Error("INVALID_TIMING");
    return startMs === cue.startMs && endMs === cue.endMs ? [] : [{ id: cue.id, startMs, endMs }];
  });
}
