import assert from "node:assert/strict";
import test from "node:test";
import { rejectedRequest, retryRejected, RejectedRequestError } from "./safe-retry";

test("retry only explicit temporary rejections with no output or usage", () => {
  for (const message of [
    "HTTP 429 retry-after: 12",
    "503 temporarily unavailable",
    "ECONNREFUSED",
    "EAI_AGAIN",
  ])
    assert.ok(rejectedRequest(message, false, 0));
  for (const message of [
    "429 quota exceeded",
    "503 authorization expired",
    "context too large",
    "ECONNRESET",
    "timeout",
    "HTTP 401",
    "HTTP 429 retry-after: 2000",
  ])
    assert.equal(rejectedRequest(message, false, 0), null);
  assert.equal(rejectedRequest("HTTP 503", true, 0), null);
  assert.equal(rejectedRequest("HTTP 503", false, 4), null);
});
test("at most two extra attempts, exponential jitter and Retry-After are respected", async () => {
  let calls = 0;
  const waits: number[] = [],
    notices: number[] = [];
  const result = await retryRejected(
    async () => {
      if (++calls < 3) throw new RejectedRequestError("HTTP 429", calls === 1 ? 9000 : undefined);
      return "saved";
    },
    new AbortController().signal,
    {
      random: () => 0.5,
      wait: async ms => {
        waits.push(ms);
      },
      onRetry: n => {
        notices.push(n.attempt);
      },
    },
  );
  assert.equal(calls, 3);
  assert.equal(result.value, "saved");
  assert.deepEqual(waits, [9000, 4250]);
  assert.deepEqual(notices, [1, 2]);
  calls = 0;
  await assert.rejects(
    retryRejected(
      async () => {
        calls++;
        throw new RejectedRequestError("HTTP 503");
      },
      new AbortController().signal,
      { wait: async () => {} },
    ),
    /503/,
  );
  assert.equal(calls, 3);
});
test("unknown failures never retry and cancellation stops before another call", async () => {
  let calls = 0;
  await assert.rejects(
    retryRejected(async () => {
      calls++;
      throw new Error("stream disconnected");
    }, new AbortController().signal),
    /disconnected/,
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  await assert.rejects(
    retryRejected(
      async () => {
        calls++;
        throw new RejectedRequestError("HTTP 503");
      },
      controller.signal,
      {
        wait: async () => {
          controller.abort();
        },
      },
    ),
    /abort/i,
  );
  assert.equal(calls, 2);
});
