import type { SubtitleCue } from "@contextual/core";
import { isLoopWindow, type LoopWindow } from "./loop-window";

export type RepeatSetting = "2" | "3" | "5" | "infinite";

export function timedCue(cue: SubtitleCue | undefined): cue is SubtitleCue & {
  startMs: number;
  endMs: number;
} {
  return !!cue && cue.startMs !== null && cue.endMs !== null && cue.endMs > cue.startMs;
}

export function scenePlaybackWindow(
  startMs: number | null,
  endMs: number | null,
): LoopWindow | null {
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  const range = { startMs: Math.round(startMs), endMs: Math.round(endMs) };
  return isLoopWindow(range) ? range : null;
}

export function effectiveCueWindow(
  cue: SubtitleCue | undefined,
  overrides: Record<string, LoopWindow>,
): LoopWindow | null {
  if (!cue) return null;
  return overrides[cue.id] ?? (timedCue(cue) ? { startMs: cue.startMs, endMs: cue.endMs } : null);
}

/** Derive playback times from source cues; saved calibration always wins. */
export function playbackCueMap(
  cues: readonly SubtitleCue[],
  platform: string,
  overrides: Record<string, LoopWindow>,
): Map<string, SubtitleCue> {
  const defaults = new Map(cues.map(cue => [cue.id, { ...cue }]));
  if (platform === "youtube") {
    const text = (cue: SubtitleCue) =>
      cue.originalText.replace(/[\s\u200b-\u200d\ufeff]+/gu, " ").trim();
    const ordered = cues
      .filter(cue => text(cue) && cue.startMs !== null && Number.isFinite(cue.startMs))
      .sort((a, b) => a.startMs! - b.startMs!);
    // Two nearest distinct texts suffice to skip repeated overlay events. Process
    // equal-time events together so an overlay cannot become a zero-length end.
    let upcoming: { text: string; startMs: number }[] = [];
    for (let end = ordered.length; end > 0;) {
      let begin = end - 1;
      const startMs = ordered[begin].startMs!;
      while (begin > 0 && ordered[begin - 1].startMs === startMs) begin--;
      const batch = ordered.slice(begin, end);
      for (const cue of batch) {
        const next = upcoming.find(item => item.text !== text(cue));
        const range = next ? scenePlaybackWindow(startMs, next.startMs) : null;
        if (range) defaults.set(cue.id, { ...cue, ...range });
      }
      const nearest = [...batch.map(cue => ({ text: text(cue), startMs })), ...upcoming];
      const seen = new Set<string>();
      upcoming = nearest
        .filter(item => {
          if (seen.has(item.text)) return false;
          seen.add(item.text);
          return true;
        })
        .slice(0, 2);
      end = begin;
    }
    for (const cue of cues) {
      if (!text(cue)) defaults.set(cue.id, { ...cue, startMs: null, endMs: null });
    }
  }
  return new Map(cues.map(cue => [cue.id, { ...defaults.get(cue.id)!, ...overrides[cue.id] }]));
}

/** Shared range for multi-cue expressions and scenes. */
export function cuePlaybackWindow(
  cueIds: readonly string[],
  cues: ReadonlyMap<string, SubtitleCue>,
): LoopWindow | null {
  const windows = cueIds
    .filter(
      id =>
        !cues.get(id) ||
        timedCue(cues.get(id)) ||
        /[^\s\u200b-\u200d\ufeff]/u.test(cues.get(id)!.originalText),
    )
    .map(id => effectiveCueWindow(cues.get(id), {}));
  if (!windows.length || !windows.every(Boolean)) return null;
  return scenePlaybackWindow(
    Math.min(...windows.map(window => window!.startMs)),
    Math.max(...windows.map(window => window!.endMs)),
  );
}

export function repeatCount(value: RepeatSetting): number | "infinite" {
  return value === "infinite" ? value : Number(value);
}

/** Returns null for an invalid, unsaved calibration range. */
export function calibratedRange(startMs: number, endMs: number): LoopWindow | null {
  const range = { startMs, endMs };
  return isLoopWindow(range) ? range : null;
}

export function adjustedStart(range: LoopWindow, deltaMs: number): LoopWindow | null {
  return calibratedRange(Math.max(0, range.startMs + deltaMs), range.endMs);
}
