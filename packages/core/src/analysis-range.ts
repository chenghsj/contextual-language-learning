import { z } from "zod";
import type { SubtitleCue } from "./schema";

export const AnalysisRangeSchema = z
  .object({
    mode: z.enum(["full", "first", "second", "custom"]),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    durationSource: z.enum(["video", "subtitles"]),
  })
  .refine(
    range => range.startMs < range.endMs && range.endMs <= range.durationMs,
    "Invalid analysis range",
  );
export type AnalysisRange = z.infer<typeof AnalysisRangeSchema>;
export type RangeSelection = { mode: AnalysisRange["mode"]; startMs: number; endMs: number };

export function timedCues(cues: SubtitleCue[]): boolean {
  return cues.length > 0 && cues.every(cue => cue.startMs !== null && cue.endMs !== null);
}
export function subtitleDuration(cues: SubtitleCue[]): number {
  return Math.max(0, ...cues.map(cue => cue.endMs ?? 0));
}
export function selectAnalysisCues(cues: SubtitleCue[], range?: RangeSelection): SubtitleCue[] {
  if (!range || range.mode === "full") return cues;
  if (!timedCues(cues)) throw new Error("Untimed subtitles only support full content");
  if (
    !Number.isFinite(range.startMs) ||
    !Number.isFinite(range.endMs) ||
    range.startMs < 0 ||
    range.startMs >= range.endMs
  )
    throw new Error("Invalid analysis range");
  return cues.filter(cue => cue.startMs! < range.endMs && cue.endMs! > range.startMs);
}
export function formatRangeTime(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}
export function parseRangeTime(text: string): number {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(text);
  return match
    ? (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 +
        Number((match[4] ?? "").padEnd(3, "0"))
    : NaN;
}
