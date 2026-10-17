import React, { act, useState } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import type { JobSummary } from "@contextual/core";
import { HeaderActions } from "../components/header-actions";

const job: JobSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceTitle: "Lesson",
  provider: "openai",
  status: "failed",
  completed: 26,
  total: 28,
  createdAt: "2026-10-04T08:00:00.000Z",
  updatedAt: "2026-10-04T08:01:00.000Z",
};

async function withActivity(
  run: (view: {
    render: (jobs: JobSummary[]) => Promise<void>;
    open: () => Promise<void>;
    close: () => Promise<void>;
    button: () => HTMLButtonElement;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://extension.test" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let close!: () => void;
  function Harness({ jobs }: { jobs: JobSummary[] }) {
    const [open, setOpen] = useState(false);
    close = () => setOpen(false);
    return (
      <div>
        <HeaderActions
          locale="zh-TW"
          page={open ? "activity" : "create"}
          runningCount={jobs.filter(job => job.status === "running").length}
          queuedCount={jobs.filter(job => job.status === "queued").length}
          onActivity={() => setOpen(true)}
          onSettings={() => {}}
        />
      </div>
    );
  }
  const render = async (jobs: JobSummary[]) => {
    await act(async () => root.render(<Harness jobs={jobs} />));
  };
  const button = () => container.querySelector<HTMLButtonElement>("#header-activity")!;
  try {
    await run({
      render,
      open: async () => {
        await act(async () => button().click());
      },
      close: async () => {
        await act(async () => close());
      },
      button,
    });
  } finally {
    await act(async () => root.unmount());
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

test("ongoing counts remain visible when viewing Activity and ended jobs have no unread indicator", async () => {
  await withActivity(async view => {
    const running = { ...job, id: "running", status: "running" as const };
    const queued = Array.from({ length: 10 }, (_, index) => ({
      ...job,
      id: `queued-${index}`,
      status: "queued" as const,
    }));
    await view.render([running, ...queued, job]);
    const badge = () => view.button().querySelector('[data-ui="activity-count"]');
    const dot = () => view.button().querySelector('[data-ui="activity-unread"]');
    assert.equal(badge()?.textContent, "9+");
    assert.equal(dot(), null);
    assert.equal(view.button().getAttribute("aria-label"), "活動 · 1 筆生成中 · 10 筆等待中");
    await view.open();
    assert.equal(dot(), null);
    assert.equal(badge()?.textContent, "9+");
    await view.close();
    await view.render([running, queued[0], job]);
    assert.equal(badge()?.textContent, "2");
    assert.equal(dot(), null);
    await view.render([job]);
    assert.equal(badge(), null);
    assert.equal(dot(), null);
    assert.equal(view.button().getAttribute("aria-label"), "活動");
    assert.equal(job.status, "failed");
  });
});
