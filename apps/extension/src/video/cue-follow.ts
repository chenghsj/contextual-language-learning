import type { SubtitleCue } from "@immersive/core";

/** Only the actual video clock and canonical cue timestamps determine playback highlighting. */
export function playingCueAt(
  cueIds: readonly string[], cues: ReadonlyMap<string, SubtitleCue>, timeMs: number | null | undefined,
): string | null {
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0) return null;
  let selected: SubtitleCue | undefined;
  for (const id of cueIds) {
    const cue = cues.get(id);
    if (!cue || cue.startMs === null || cue.endMs === null || cue.endMs <= cue.startMs) continue;
    if (cue.startMs <= timeMs && timeMs < cue.endMs &&
        (!selected || cue.startMs >= selected.startMs!)) selected = cue;
  }
  return selected?.id ?? null;
}
