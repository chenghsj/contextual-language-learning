import assert from "node:assert/strict";
import test from "node:test";
import { RunningOperation, assertCancellationOwner } from "./running-operation";

test("a cancellation deadline rejects without claiming the AI stopped; a retry can confirm later", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const operation = new RunningOperation();
  const cancelling = operation.cancel();
  const unconfirmed = assert.rejects(cancelling, /not confirmed/);
  assert.equal(operation.controller.signal.aborted, true);
  context.mock.timers.tick(15_000);
  await unconfirmed;
  operation.finish();
  await operation.cancel();
});

test("cancellation cannot be acknowledged on behalf of another live Host", context => {
  context.mock.method(process, "kill", () => true);
  assert.throws(() => assertCancellationOwner(process.pid + 1), /another Host/);
  assert.doesNotThrow(() => assertCancellationOwner(process.pid));
  context.mock.method(process, "kill", () => {
    throw Object.assign(new Error("Not found"), { code: "ESRCH" });
  });
  assert.doesNotThrow(() => assertCancellationOwner(process.pid + 1));
});
