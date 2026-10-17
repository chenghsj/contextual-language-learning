import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { CancellationTracker, type CancellationState } from "./cancellation-tracker";

test("cancel errors preserve uncertainty, retries keep custom routing, and unrelated replies cannot confirm", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let state: CancellationState = {};
  const tracker = new CancellationTracker(next => (state = next)),
    jobId = randomUUID();
  try {
    const first = tracker.request(jobId, "custom")!;
    assert.equal(first.type, "cancelCustom");
    assert.equal(tracker.request(jobId, "custom"), null);
    assert.equal(tracker.receive({ id: randomUUID(), type: "cancelled" }), false);
    assert.equal(state[jobId].status, "pending");
    assert.equal(
      tracker.receive({ id: first.id, type: "error", message: "AI still stopping" }),
      true,
    );
    assert.equal(state[jobId].status, "unconfirmed");
    const retry = tracker.request(jobId, "custom")!;
    assert.notEqual(retry.id, first.id);
    assert.equal(retry.type, "cancelCustom");
    context.mock.timers.tick(30_000);
    assert.equal(state[jobId].status, "unconfirmed");
    tracker.receive({ id: retry.id, type: "cancelled" });
    assert.deepEqual(state, {});
    assert.equal(tracker.wasCancelled(jobId), true);
  } finally {
    tracker.dispose();
  }
});

test("a completed task wins a cancellation race and is never reported as cancelled", () => {
  let state: CancellationState = {};
  const tracker = new CancellationTracker(next => (state = next)),
    jobId = randomUUID();
  try {
    const request = tracker.request(jobId, "standard")!;
    tracker.receive({
      id: randomUUID(),
      type: "job",
      job: {
        id: jobId,
        status: "completed",
        sourceTitle: "Finished",
        provider: "openai",
        completed: 1,
        total: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    assert.deepEqual(state, {});
    assert.equal(tracker.wasCancelled(jobId), false);
    assert.equal(
      tracker.receive({ id: request.id, type: "error", message: "Not cancellable" }),
      false,
    );
    assert.deepEqual(state, {});
  } finally {
    tracker.dispose();
  }
});
