/** Netflix can emit seeking before currentTime reflects a programmatic seek.
 * Track the request, not the event's initial (old) currentTime. */
export const NETFLIX_SEEK_GRACE_MS = 8_000;
export const NETFLIX_SEEK_TOLERANCE_MS = 2_500;

export function isManagedNetflixSeek(
  targetMs: number | null,
  deadlineMs: number,
  nowMs: number,
): boolean {
  return targetMs !== null && nowMs <= deadlineMs;
}

export function reachedNetflixSeekTarget(
  targetMs: number | null,
  actualMs: number,
  isSeeking: boolean,
): boolean {
  return (
    targetMs !== null &&
    Number.isFinite(actualMs) &&
    !isSeeking &&
    Math.abs(actualMs - targetMs) <= NETFLIX_SEEK_TOLERANCE_MS
  );
}

export function netflixLoopReachedEnd(actualMs: number, endMs: number): boolean {
  return Number.isFinite(actualMs) && actualMs >= endMs - 90;
}
