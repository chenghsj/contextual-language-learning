import type { SubtitleCue } from "@immersive/core";

type ActiveCuePlayback = { cueId: string; startMs: number; endMs: number };

/** Follow source subtitles unless a sentence playback is currently controlling the video. */
export function playingCueAt(
  cueIds: readonly string[], cues: ReadonlyMap<string, SubtitleCue>, timeMs: number | null | undefined,
  activePlayback?: ActiveCuePlayback | null,
): string | null {
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0) return null;
  if (activePlayback && cueIds.includes(activePlayback.cueId) &&
      activePlayback.startMs <= timeMs && timeMs < activePlayback.endMs) {
    return activePlayback.cueId;
  }
  let selected: SubtitleCue | undefined;
  for (const id of cueIds) {
    const cue = cues.get(id);
    if (!cue || cue.startMs === null || cue.endMs === null || cue.endMs <= cue.startMs) continue;
    if (cue.startMs <= timeMs && timeMs < cue.endMs &&
        (!selected || cue.startMs >= selected.startMs!)) selected = cue;
  }
  return selected?.id ?? null;
}
