/** User-calibrated A/B playback boundaries, independent of the subtitle timestamps. */
export type LoopWindow = { startMs: number; endMs: number };
export type LoopBoundary = "start" | "end";
export const MIN_LOOP_DURATION_MS = 250;
export const MAX_LOOP_DURATION_MS = 600_000;
const MAX_POSITION_MS = 43_200_000;

export function isLoopWindow(value: unknown): value is LoopWindow {
  if (!value || typeof value !== "object") return false;
  const { startMs, endMs } = value as Record<string, unknown>;
  return (
    typeof startMs === "number" &&
    typeof endMs === "number" &&
    Number.isSafeInteger(startMs) &&
    Number.isSafeInteger(endMs) &&
    startMs >= 0 &&
    endMs <= MAX_POSITION_MS &&
    endMs - startMs >= MIN_LOOP_DURATION_MS &&
    endMs - startMs <= MAX_LOOP_DURATION_MS
  );
}

/** Reject corrupted saved values and cues that no longer belong to this lesson. */
export function readLoopWindows(
  value: unknown,
  cueIds: readonly string[],
): Record<string, LoopWindow> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const known = new Set(cueIds);
  return Object.fromEntries(
    Object.entries(value).filter(([cueId, bounds]) => known.has(cueId) && isLoopWindow(bounds)),
  ) as Record<string, LoopWindow>;
}

/** Round the current video clock to 100ms, and reject overlapping/reversed bounds. */
export function adjustLoopBoundary(
  original: LoopWindow,
  boundary: LoopBoundary,
  positionMs: number,
): LoopWindow | null {
  if (!isLoopWindow(original) || !Number.isFinite(positionMs) || positionMs < 0) return null;
  const ms = Math.round(positionMs / 100) * 100;
  const next = boundary === "start" ? { ...original, startMs: ms } : { ...original, endMs: ms };
  return isLoopWindow(next) ? next : null;
}

export function formatLoopTimestamp(milliseconds: number): string {
  const rounded = Math.round(milliseconds / 100) * 100;
  const minutes = Math.floor(rounded / 60_000);
  const seconds = String(Math.floor(rounded / 1_000) % 60).padStart(2, "0");
  return (
    minutes.toString().padStart(2, "0") + ":" + seconds + "." + Math.floor((rounded % 1_000) / 100)
  );
}
