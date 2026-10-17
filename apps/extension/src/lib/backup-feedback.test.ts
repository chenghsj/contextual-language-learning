import test from "node:test";
import assert from "node:assert/strict";
import type { JobSummary } from "@contextual/core";
import { backupFeedbackResult } from "./backup-feedback";

function job(
  id: string,
  status: NonNullable<JobSummary["backup"]>["status"],
  accountId = "drive",
): JobSummary {
  return {
    id,
    sourceTitle: id,
    provider: "openai",
    status: "completed",
    completed: 1,
    total: 1,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
    backup: { accountId, status, updatedAt: "2026-10-12T00:00:00Z" },
  };
}
test("backup success requires completed records for every requested job in the selected account", () => {
  assert.equal(
    backupFeedbackResult([job("a", "backed-up"), job("b", "failed", "other")], "drive", ["a"])
      .status,
    "completed",
  );
  for (const status of ["pending", "uploading", "paused", "conflict"] as const)
    assert.equal(backupFeedbackResult([job("a", status)], "drive", ["a"]).status, "attention");
  assert.equal(backupFeedbackResult([], "drive").status, "attention");
  assert.equal(
    backupFeedbackResult([job("a", "backed-up")], "drive", ["a", "missing"]).status,
    "attention",
  );
  assert.equal(
    backupFeedbackResult([job("a", "backed-up", "other")], "drive", ["a"]).status,
    "attention",
  );
  assert.deepEqual(backupFeedbackResult([job("a", "failed"), job("b", "backed-up")], "drive"), {
    status: "failed",
    failed: 1,
  });
});
