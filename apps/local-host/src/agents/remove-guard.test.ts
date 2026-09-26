import assert from "node:assert/strict";
import test from "node:test";
import { assertAgentMayBeRemoved } from "./remove-guard";

const agent = "custom-" + "a".repeat(24);
for (const status of ["queued", "running", "waiting", "failed"] as const) {
  test("removal refuses " + status + " jobs for the same Agent", () => {
    assert.throws(() => assertAgentMayBeRemoved(agent, [{ provider: agent, status }]), /cancel/);
  });
}
test("completed/cancelled jobs and other Agents' jobs do not block removal", () => {
  assert.doesNotThrow(() => assertAgentMayBeRemoved(agent, [
    { provider: agent, status: "completed" },
    { provider: agent, status: "cancelled" },
    { provider: "other", status: "waiting" },
  ]));
});
