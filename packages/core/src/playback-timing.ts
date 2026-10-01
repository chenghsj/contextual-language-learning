import type { LearningDocument, PlaybackOverride } from "./schema";

/** Keep source timings intact. A sentence edit expands every containing scene, never shrinks it. */
export function withSentenceTiming(document: LearningDocument, cueId: string,
  range: PlaybackOverride | null): LearningDocument {
  const playbackOverrides = { ...document.playbackOverrides };
  if (range) playbackOverrides[cueId] = range;
  else delete playbackOverrides[cueId];
  const scenePlaybackOverrides = { ...document.scenePlaybackOverrides };
  if (range) for (const scene of document.sections) {
    if (!scene.cueIds.includes(cueId)) continue;
    const current = scenePlaybackOverrides[scene.id] ??
      (scene.startMs !== null && scene.endMs !== null ? { startMs: scene.startMs, endMs: scene.endMs } : null);
    if (!current) continue;
    const ranges = scene.cueIds.flatMap(id => {
      const cue = document.cues.find(item => item.id === id);
      const effective = playbackOverrides[id] ?? cue;
      return effective?.startMs !== null && effective?.startMs !== undefined &&
        effective.endMs !== null ? [{ startMs: effective.startMs, endMs: effective.endMs }] : [];
    });
    const startMs = Math.min(current.startMs, ...ranges.map(item => item.startMs));
    const endMs = Math.max(current.endMs, ...ranges.map(item => item.endMs));
    if (startMs !== current.startMs || endMs !== current.endMs) scenePlaybackOverrides[scene.id] = { startMs, endMs };
  }
  return { ...document, playbackOverrides, scenePlaybackOverrides };
}
