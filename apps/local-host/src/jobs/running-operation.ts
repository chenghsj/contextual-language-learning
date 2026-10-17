/** A cancellation is confirmed only after the execution and its checkpoint writes settle. */
export class RunningOperation {
  readonly controller = new AbortController();
  cancelRequested = false;
  private resolve!: () => void;
  private readonly settled = new Promise<void>(resolve => {
    this.resolve = resolve;
  });
  finish() {
    this.resolve();
  }
  async cancel(timeoutMs = 15_000) {
    this.cancelRequested = true;
    this.controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.settled,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Cancellation is not confirmed: AI execution is still stopping. Retry cancellation.",
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Another live Host owns its own AbortController; never acknowledge cancellation on its behalf. */
export function assertCancellationOwner(ownerPid: number | undefined) {
  if (!ownerPid || ownerPid === process.pid) return;
  let alive = false;
  try {
    process.kill(ownerPid, 0);
    alive = true;
  } catch (error) {
    alive = (error as NodeJS.ErrnoException).code === "EPERM";
  }
  if (alive)
    throw new Error(
      "Cancellation is not confirmed: another Host owns this task. Retry from its connected panel.",
    );
}
