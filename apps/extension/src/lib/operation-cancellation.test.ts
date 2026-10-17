import assert from "node:assert/strict";
import test from "node:test";
import { wasOperationCancelled } from "./operation-cancellation";

test("explicit user cancellation stays local to its operation", () => {
  assert.equal(wasOperationCancelled(new Error("Folder selection cancelled."), "folder"), true);
  assert.equal(
    wasOperationCancelled(new Error("Google authorization was declined"), "google"),
    true,
  );
  assert.equal(wasOperationCancelled(new Error("Folder selection cancelled."), "google"), false);
  assert.equal(
    wasOperationCancelled(new Error("Google authorization was declined"), "folder"),
    false,
  );
});
test("timeouts, denied filesystem access and service failures are not silent cancellations", () => {
  for (const cause of [
    new Error("Could not open the macOS folder picker."),
    new Error("Google authorization expired"),
    new Error("Google authorization failed"),
    new Error("Permission denied"),
    new Error("Cancelled network request due to timeout"),
    "Folder selection cancelled.",
    undefined,
  ]) {
    for (const operation of ["folder", "google"] as const)
      assert.equal(wasOperationCancelled(cause, operation), false);
  }
});
