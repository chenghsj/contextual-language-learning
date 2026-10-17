/** Only the local execution deadline authorizes automatic checkpoint continuation. */
export function isTimeoutInterruption(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted || signal.reason?.name !== "TimeoutError") return false;
  return (
    error === signal.reason ||
    (error instanceof Error &&
      (error.cause === signal.reason || error.message === "Job was interrupted"))
  );
}
