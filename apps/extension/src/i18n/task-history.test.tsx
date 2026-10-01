import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { matchesJobFilter, taskHistoryError, TaskHistory } from "../components/task-history";
import { translate } from "./messages";

test("activity filters distinguish recoverable failures from active and cancelled jobs", () => {
  const statuses = ["queued", "running", "waiting", "failed", "completed", "cancelled"] as const;
  assert.deepEqual(statuses.filter(status => matchesJobFilter(status, "all")), statuses);
  assert.deepEqual(statuses.filter(status => matchesJobFilter(status, "active")), ["queued", "running", "waiting"]);
  for (const filter of ["failed", "completed", "cancelled"] as const) {
    assert.deepEqual(statuses.filter(status => matchesJobFilter(status, filter)), [filter]);
  }
});

test("failed and cancelled jobs retain a resume action", () => {
  for (const status of ["failed", "cancelled"] as const) {
    const now = "2026-10-01T00:00:00.000Z";
    const html = renderToStaticMarkup(<TaskHistory locale="zh-TW" jobs={[{
      id: "task", sourceTitle: "Example", provider: "openai", status,
      completed: 2, total: 4, createdAt: now, updatedAt: now,
    }]} loadingJobs={false} hostReady={true} generating={false} storageBusy={false}
      agentCatalog={[{ id: "openai", label: "OpenAI", installed: true, supportsAccountProfiles: false }]}
      t={(key, params) => translate("zh-TW", key, params)} onRefresh={() => undefined}
      onResume={() => undefined} onOpen={() => undefined}
      onRetryPublication={async () => undefined} onRetryBackup={async () => undefined} />);
    assert.ok(html.includes(translate("zh-TW", "resume")));
  }
});


test("old Host requests show a localized update instruction instead of a schema dump", () => {
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    for (const message of ["Invalid request: Invalid discriminator value. Expected piProviders | health | listJobs", "Unsupported Native Host request."]) {
      assert.equal(taskHistoryError(new Error(message), t, "loadJobRecordsError"), t("taskHistoryHostUpdate"));
    }
    assert.equal(taskHistoryError(new Error("Disk unavailable"), t, "deleteJobRecordsError"), "Disk unavailable");
  }
});
