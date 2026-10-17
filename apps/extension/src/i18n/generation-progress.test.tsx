import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import type { JobSummary } from "@contextual/core";
import { GenerationStatus } from "../components/generation-status";
import { JobProgress } from "../components/job-progress";
import { TaskHistory } from "../components/task-history";
import { generationProgressCopy } from "./generation-progress";
import { translate, type UiLocale } from "./messages";
import { sidePanelLayoutCopy } from "./side-panel-layout";

const noop = () => undefined;
const base: JobSummary = {
  id: "db39209f-ff43-4683-9bb4-a1796895f995",
  provider: "antigravity",
  sourceTitle: "Example",
  status: "running",
  phase: "creating",
  completed: 9,
  total: 11,
  createdAt: "2026-10-09T10:00:00Z",
  updatedAt: "2026-10-09T10:00:00Z",
  execution: {
    schemaVersion: "7",
    workflowVersion: "learning-points-v6-2",
    promptVersion: "learning-points-prompts-5",
    inputFingerprint: "a".repeat(64),
    provider: "antigravity",
    modelId: "gemini-3.7-flash",
    contextWindow: 1048576,
    maxOutputTokens: 65536,
  },
};

function history(job: JobSummary, locale: UiLocale) {
  return (
    <TaskHistory
      locale={locale}
      jobs={[job]}
      loadingJobs={false}
      hostReady
      generating
      storageBusy={false}
      agentCatalog={[]}
      t={(key, params) => translate(locale, key, params)}
      onRefresh={noop}
      onResume={noop}
      onOpen={noop}
      onRetryPublication={async () => {}}
      onRetryBackup={async () => {}}
    />
  );
}

test("V6 splitting keeps completed work visible without a growing denominator or false percentage", () => {
  for (const locale of ["zh-TW", "zh-CN", "en", "ja", "ko"] as const) {
    for (const [completed, total] of [
      [9, 11],
      [10, 12],
      [10, 13],
    ]) {
      const job = { ...base, completed, total };
      for (const element of [
        <GenerationStatus
          locale={locale}
          job={job}
          title="Example"
          progress=""
          notificationsEnabled
          compact
          onLibrary={noop}
        />,
        history(job, locale),
      ]) {
        const dom = new JSDOM(renderToStaticMarkup(element));
        try {
          const content = dom.window.document.querySelector('[data-ui="jobProgress"]')!;
          assert.ok(
            content.textContent?.includes(generationProgressCopy[locale].completed(completed)),
          );
          assert.doesNotMatch(content.textContent!, /\d+\s*[/／]\s*\d+/);
          assert.equal(content.querySelector('[role="progressbar"]'), null);
          const stages = dom.window.document.querySelectorAll('[data-ui="jobStage"]');
          assert.equal(stages.length, 1);
          assert.equal(stages[0].textContent, sidePanelLayoutCopy[locale].creating);
          assert.ok(stages[0].querySelector("svg.animate-spin"));
        } finally {
          dom.window.close();
        }
      }
    }
  }
});

test("V6 interrupted work retains counts; completed lessons show a check instead of a bar", () => {
  for (const status of ["waiting", "failed", "cancelled", "completed"] as const) {
    const job = { ...base, status, completed: status === "completed" ? 13 : 10, total: 13 };
    const dom = new JSDOM(renderToStaticMarkup(history(job, "zh-TW")));
    try {
      assert.equal(dom.window.document.querySelector('[role="progressbar"]'), null);
      assert.equal(dom.window.document.querySelector("svg.animate-spin"), null);
      assert.ok(
        dom.window.document.body.textContent?.includes(
          generationProgressCopy["zh-TW"].completed(job.completed),
        ),
      );
      const stage = dom.window.document.querySelector('[data-ui="jobStage"]');
      assert.equal(
        stage?.textContent ?? null,
        status === "completed" ? generationProgressCopy["zh-TW"].ready : null,
      );
      if (status === "completed") assert.ok(stage?.querySelector("svg"));
    } finally {
      dom.window.close();
    }
  }
});

test("legacy and custom job progress keeps its existing fixed-count presentation", () => {
  for (const execution of [
    undefined,
    { ...base.execution!, schemaVersion: "5" },
    { ...base.execution!, schemaVersion: "custom-v1" },
  ]) {
    const dom = new JSDOM(
      renderToStaticMarkup(
        <JobProgress job={{ ...base, execution }} locale="en" legacyText="9 / 11" />,
      ),
    );
    try {
      assert.equal(
        Number(
          dom.window.document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
        ),
        (100 * 9) / 11,
      );
      assert.ok(dom.window.document.body.textContent?.includes("9 / 11"));
    } finally {
      dom.window.close();
    }
  }
});

test("stream activity is localized, shows parallel windows, and disappears at termination", () => {
  const startedAt = new Date().toISOString();
  const activity = (["waiting", "thinking"] as const).map((state, i) => ({
    id: "call" + i,
    step: "window-" + i,
    state,
    startedAt,
    updatedAt: startedAt,
  }));
  for (const locale of ["zh-TW", "zh-CN", "en", "ja", "ko"] as const) {
    const html = renderToStaticMarkup(
      <JobProgress job={{ ...base, activity }} locale={locale} legacyText="" />,
    );
    assert.ok(html.includes(generationProgressCopy[locale].active(2)));
    assert.ok(html.includes(generationProgressCopy[locale].states.waiting));
    assert.ok(html.includes(generationProgressCopy[locale].states.thinking));
    assert.ok(
      html.includes(
        generationProgressCopy[locale].activity(
          "1",
          generationProgressCopy[locale].states.waiting,
          0,
        ),
      ),
    );
    assert.ok(
      html.includes(
        generationProgressCopy[locale].activity(
          "2",
          generationProgressCopy[locale].states.thinking,
          0,
        ),
      ),
    );
    assert.ok(
      !renderToStaticMarkup(
        <JobProgress
          job={{ ...base, status: "completed", activity }}
          locale={locale}
          legacyText=""
        />,
      ).includes('data-ui="jobActivity"'),
    );
  }
});

test("activity identity and elapsed time survive state changes, peer completion, and repair calls", t => {
  const now = Date.parse("2026-10-12T02:00:45Z");
  t.mock.method(Date, "now", () => now);
  const first = {
    id: "first",
    step: "window-0",
    state: "thinking" as const,
    startedAt: new Date(now - 45000).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  const second = {
    ...first,
    id: "second",
    step: "window-1",
    startedAt: new Date(now - 43000).toISOString(),
  };
  const text = (activity: JobSummary["activity"]) => {
    const dom = new JSDOM(
      renderToStaticMarkup(
        <JobProgress job={{ ...base, activity }} locale="zh-TW" legacyText="" />,
      ),
    );
    try {
      return [...dom.window.document.querySelectorAll('[data-ui="jobActivity"] p')].map(
        p => p.textContent,
      );
    } finally {
      dom.window.close();
    }
  };
  assert.deepEqual(text([first, second]), [
    "2 個分析片段執行中",
    "分析片段 1 · 推理中 · 已耗時 45 秒",
    "分析片段 2 · 推理中 · 已耗時 43 秒",
  ]);
  assert.deepEqual(text([{ ...second, state: "writing" }]), ["分析片段 2 · 輸出中 · 已耗時 43 秒"]);
  assert.deepEqual(
    text([
      {
        ...second,
        id: "new-call",
        step: "window-1-repair-output-16384",
        startedAt: new Date(now - 2000).toISOString(),
      },
    ]),
    ["分析片段 2 · 推理中 · 已耗時 2 秒"],
  );
});

test("split windows keep distinct parent identities and non-analysis steps do not expose internal IDs", () => {
  const startedAt = new Date().toISOString();
  const calls = (steps: string[]) =>
    steps.map((step, i) => ({
      id: "call" + i,
      step,
      state: "waiting" as const,
      startedAt,
      updatedAt: startedAt,
    }));
  const split = renderToStaticMarkup(
    <JobProgress
      job={{ ...base, activity: calls(["window-3aa", "window-3ab-repair"]) }}
      locale="zh-TW"
      legacyText=""
    />,
  );
  assert.ok(split.includes("分析片段 4.1.1"));
  assert.ok(split.includes("分析片段 4.1.2"));
  const selection = renderToStaticMarkup(
    <JobProgress job={{ ...base, activity: calls(["selection"]) }} locale="zh-TW" legacyText="" />,
  );
  assert.ok(selection.includes("等待回應 · 已耗時"));
  assert.ok(!selection.includes("分析片段"));
  assert.ok(!selection.includes("selection"));
});
