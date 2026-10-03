import { setTimeout as delay } from "node:timers/promises";

export type RetryNotice = { attempt: number; delayMs: number; reason: string };
/** Only explicit rejected requests without output/usage may be resent. Stream failures remain unknown. */
export class RejectedRequestError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RejectedRequestError";
  }
}
export function rejectedRequest(message: string, hasOutput: boolean, usedTokens: number) {
  if (
    hasOutput ||
    usedTokens > 0 ||
    /auth|unauthorized|forbidden|quota|billing|credit|insufficient|invalid|context|token limit/i.test(
      message,
    )
  )
    return null;
  if (
    !/\b(?:429|500|502|503|504)\b|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|overloaded|temporarily unavailable/i.test(
      message,
    )
  )
    return null;
  const seconds = message.match(/retry[-_ ]after\s*[:=]?\s*(\d+(?:\.\d+)?)/i)?.[1];
  const retryAfterMs = seconds === undefined ? undefined : Number(seconds) * 1000;
  // Never shorten a provider's long wait. Leave long cooldowns to manual recovery.
  if (retryAfterMs !== undefined && retryAfterMs > 15 * 60_000) return null;
  return new RejectedRequestError(message, retryAfterMs);
}
export async function retryRejected<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
  options: {
    onRetry?: (notice: RetryNotice) => Promise<void> | void;
    wait?: (ms: number, signal: AbortSignal) => Promise<unknown>;
    random?: () => number;
  } = {},
): Promise<{ value: T; retries: RetryNotice[] }> {
  const retries: RetryNotice[] = [];
  for (;;) {
    signal.throwIfAborted();
    try {
      return { value: await run(), retries };
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof RejectedRequestError) || retries.length === 2) throw error;
      const notice = {
        attempt: retries.length + 1,
        delayMs: Math.max(
          error.retryAfterMs ?? 0,
          2000 * 2 ** retries.length + Math.round((options.random ?? Math.random)() * 500),
        ),
        reason: error.message.slice(0, 500),
      };
      retries.push(notice);
      await options.onRetry?.(notice);
      await (options.wait ?? ((ms, abort) => delay(ms, undefined, { signal: abort })))(
        notice.delayMs,
        signal,
      );
    }
  }
}
