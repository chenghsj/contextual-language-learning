import type { SubtitleCue } from "@immersive/core";
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
  return timedCue(cue) ? (overrides[cue.id] ?? { startMs: cue.startMs, endMs: cue.endMs }) : null;
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
