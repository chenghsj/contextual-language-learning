import test from "node:test";
import assert from "node:assert/strict";
import { isTimeoutInterruption } from "./timeout-interruption";
test("only deadline-caused interruption resumes automatically, never a concurrent paid/validation failure", () => {
  const controller = new AbortController();
  const timeout = new DOMException("Execution deadline", "TimeoutError");
  controller.abort(timeout);
  assert.equal(isTimeoutInterruption(timeout, controller.signal), true);
  assert.equal(
    isTimeoutInterruption(new Error("request interrupted", { cause: timeout }), controller.signal),
    true,
  );
  assert.equal(isTimeoutInterruption(new Error("Job was interrupted"), controller.signal), true);
  for (const error of [
    new Error("Model returned no final answer"),
    new Error("Invalid completed quality response"),
    new Error("Source range is invalid"),
    new DOMException("Remote timeout", "TimeoutError"),
  ])
    assert.equal(isTimeoutInterruption(error, controller.signal), false);
  const userCancel = new AbortController();
  userCancel.abort();
  assert.equal(isTimeoutInterruption(userCancel.signal.reason, userCancel.signal), false);
});
