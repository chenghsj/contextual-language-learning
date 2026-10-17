import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { matchesJobFilter, taskHistoryError, TaskHistory } from "../components/task-history";
import { translate } from "./messages";
import { layoutText, sidePanelLayoutCopy } from "./side-panel-layout";
import type { JobSummary } from "@contextual/core";

test("activity details show generation steps, service and recovery information", () => {
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    for (const status of [
      "completed",
      "failed",
      "running",
      "waiting",
      "queued",
      "cancelled",
    ] as const) {
      const timestamp = "2026-10-03T08:51:00.000Z";
      const completed = status === "completed" ? 28 : 26;
      const dom = new JSDOM(
        renderToStaticMarkup(
          <TaskHistory
            locale={locale}
            jobs={[
              {
                id: "task",
                sourceTitle: "Example",
                provider: "openai",
                status,
                phase: "creating",
                completed,
                total: 28,
                createdAt: timestamp,
                updatedAt: timestamp,
                ...(status === "failed" ? { error: "Generation failed" } : {}),
                backup: { status: "backed-up", accountId: "account", updatedAt: timestamp },
              },
            ]}
            loadingJobs={false}
            hostReady
            generating={false}
            storageBusy={false}
            agentCatalog={[{ id: "openai", label: "OpenAI", installed: true }]}
            t={(key, params) => translate(locale, key, params)}
            onRefresh={() => undefined}
            onResume={() => undefined}
            onOpen={() => undefined}
            onRetryPublication={async () => undefined}
            onRetryBackup={async () => undefined}
          />,
        ),
      );
      try {
        const item = dom.window.document.querySelector('[data-ui="taskHistoryItem"]')!;
        const details = item.querySelector('[data-ui="taskHistoryDetails"]')!;
        const summary = item.querySelector("h3 button")!.textContent!;
        assert.ok(details.textContent!.includes("OpenAI"));
        assert.ok(details.textContent!.includes(translate(locale, "backupSaved")));
        assert.ok(!details.textContent!.includes(`${completed} / 28`));
        assert.ok(!details.textContent!.includes(sidePanelLayoutCopy[locale].creating));
        if (status !== "queued") {
          assert.ok(
            details.textContent!.includes(
              layoutText(sidePanelLayoutCopy[locale].completedSteps, {
                completed,
                total: 28,
              }),
            ),
          );
          const progress = details.querySelector('[role="progressbar"]')!;
          assert.equal(Number(progress.getAttribute("aria-valuenow")), (100 * completed) / 28);
        } else {
          assert.equal(details.querySelector('[role="progressbar"]'), null);
        }
        if (status !== "completed") assert.ok(!summary.includes(`${completed} / 28`));
        if (status === "completed") {
          const completedAt = layoutText(sidePanelLayoutCopy[locale].completedAt, {
            time: new Date(timestamp).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
          assert.ok(summary.includes(completedAt));
          assert.ok(!details.textContent!.includes(completedAt));
        }
        if (["failed", "waiting", "cancelled"].includes(status)) {
          assert.ok(details.textContent!.includes(translate(locale, "resume")));
        }
        if (status === "failed") assert.ok(details.querySelector('[data-ui="piFeedback"]'));
      } finally {
        dom.window.close();
      }
    }
  }
});

test("activity filters distinguish recoverable failures from active and cancelled jobs", () => {
  const statuses = ["queued", "running", "waiting", "failed", "completed", "cancelled"] as const;
  assert.deepEqual(
    statuses.filter(status => matchesJobFilter(status, "all")),
    statuses,
  );
  assert.deepEqual(
    statuses.filter(status => matchesJobFilter(status, "active")),
    ["queued", "running", "waiting"],
  );
  for (const filter of ["failed", "completed", "cancelled"] as const) {
    assert.deepEqual(
      statuses.filter(status => matchesJobFilter(status, filter)),
      [filter],
    );
  }
});

test("failed and cancelled jobs retain a resume action", () => {
  for (const status of ["failed", "cancelled"] as const) {
    const now = "2026-10-01T00:00:00.000Z";
    const html = renderToStaticMarkup(
      <TaskHistory
        locale="zh-TW"
        jobs={[
          {
            id: "task",
            sourceTitle: "Example",
            provider: "openai",
            status,
            completed: 2,
            total: 4,
            createdAt: now,
            updatedAt: now,
          },
        ]}
        loadingJobs={false}
        hostReady={true}
        generating={false}
        storageBusy={false}
        agentCatalog={[{ id: "openai", label: "OpenAI", installed: true }]}
        t={(key, params) => translate("zh-TW", key, params)}
        onRefresh={() => undefined}
        onResume={() => undefined}
        onOpen={() => undefined}
        onRetryPublication={async () => undefined}
        onRetryBackup={async () => undefined}
      />,
    );
    assert.ok(html.includes(translate("zh-TW", "resume")));
  }
});

test("old Host requests show a localized update instruction instead of a schema dump", () => {
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    for (const message of [
      "Invalid request: Invalid discriminator value. Expected piProviders | health | listJobs",
      "Unsupported Native Host request.",
    ]) {
      assert.equal(
        taskHistoryError(new Error(message), t, "loadJobRecordsError"),
        t("taskHistoryHostUpdate"),
      );
    }
    assert.equal(
      taskHistoryError(new Error("Disk unavailable"), t, "deleteJobRecordsError"),
      "Disk unavailable",
    );
  }
});

test("all Activity pins every ongoing job ahead of the newest three ended records", () => {
  const base = {
    provider: "openai",
    completed: 2,
    total: 6,
    phase: "creating" as const,
    createdAt: "2026-10-09T01:00:00.000Z",
    updatedAt: "2026-10-09T01:00:00.000Z",
  };
  const record = (id: string, status: JobSummary["status"], minute: number): JobSummary => ({
    ...base,
    id,
    sourceTitle: id,
    status,
    createdAt: `2026-10-09T01:${String(minute).padStart(2, "0")}:00.000Z`,
    updatedAt: `2026-10-09T01:${String(minute).padStart(2, "0")}:00.000Z`,
  });
  const jobs = [
    record("cancelled", "cancelled", 9),
    record("queued-late", "queued", 3),
    record("failed", "failed", 8),
    record("waiting", "waiting", 6),
    record("running", "running", 0),
    record("queued-first", "queued", 1),
    record("queued-middle", "queued", 2),
    record("completed-old", "completed", 4),
    record("completed-new", "completed", 7),
  ];
  const dom = new JSDOM(
    renderToStaticMarkup(
      <TaskHistory
        jobs={jobs}
        locale="zh-TW"
        hostReady
        generating
        loadingJobs={false}
        storageBusy={false}
        agentCatalog={[]}
        t={(key, params) => translate("zh-TW", key, params)}
        onRefresh={() => {}}
        onResume={() => {}}
        onOpen={() => {}}
        onRetryPublication={async () => {}}
        onRetryBackup={async () => {}}
      />,
    ),
  );
  try {
    const rows = [...dom.window.document.querySelectorAll('[data-ui="taskHistoryItem"]')];
    assert.deepEqual(
      rows.map(row => row.querySelector("[title]")?.getAttribute("title")),
      [
        "running",
        "queued-first",
        "queued-middle",
        "queued-late",
        "waiting",
        "cancelled",
        "failed",
        "completed-new",
      ],
    );
    assert.ok(rows[1].textContent?.includes("等待序號: 1"));
    assert.ok(rows[3].textContent?.includes("等待序號: 3"));
    assert.ok(
      dom.window.document.body.textContent?.includes(
        translate("zh-TW", "showMoreJobs", { count: 1 }),
      ),
    );
    assert.equal(
      rows[0].querySelector('[data-ui="taskHistoryDetails"]')?.hasAttribute("hidden"),
      true,
    );
  } finally {
    dom.window.close();
  }
});
