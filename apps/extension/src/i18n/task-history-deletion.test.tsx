import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Install DOM globals before importing Radix, which chooses its effect at load time.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://extension.test",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "NodeFilter",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { TaskHistory } = await import("../components/task-history");
const { translate } = await import("./messages");
import type { JobSummary } from "@contextual/core";
const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("zh-TW", key, params);
const now = "2026-10-01T00:00:00.000Z";
function job(id: string, status: JobSummary["status"]): JobSummary {
  return {
    id,
    status,
    sourceTitle: id,
    provider: "openai",
    completed: 0,
    total: 4,
    createdAt: now,
    updatedAt: now,
  };
}
async function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    async render(next: React.ReactNode) {
      await act(async () => root.render(next));
    },
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).focus();
    (element as HTMLElement).click();
  });
}
function button(label: string, parent: Element = document.body): HTMLButtonElement {
  const found = [...parent.querySelectorAll("button")].find(item => item.textContent === label);
  assert.ok(found, "Missing button: " + label);
  return found;
}
function History(
  props: Pick<React.ComponentProps<typeof TaskHistory>, "jobs" | "onListEnded" | "onDeleteRecords">,
) {
  return (
    <TaskHistory
      {...props}
      locale="zh-TW"
      hostReady
      loadingJobs={false}
      generating={false}
      storageBusy={false}
      agentCatalog={[{ id: "openai", label: "OpenAI", installed: true }]}
      t={t}
      onRefresh={() => undefined}
      onResume={() => undefined}
      onOpen={() => undefined}
      onRetryPublication={async () => undefined}
      onRetryBackup={async () => undefined}
    />
  );
}

test("single deletion requires confirmation, cancellation preserves records and focus", async () => {
  let calls = 0;
  const jobs = [job("Failed lesson", "failed"), job("Running lesson", "running")];
  const view = await mount(
    <History
      jobs={jobs}
      onListEnded={async () => [jobs[0]]}
      onDeleteRecords={async ids => {
        calls++;
        return { deleted: ids, failed: [] };
      }}
    />,
  );
  try {
    const row = view.container.querySelector('[data-ui="taskHistoryItem"]')!;
    const disclosure = row.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    const details = row.querySelector<HTMLElement>('[data-ui="taskHistoryDetails"]')!;
    assert.equal(disclosure.getAttribute("aria-expanded"), "false");
    assert.equal(details.hidden, true);
    await click(disclosure);
    assert.equal(details.hidden, false);
    assert.equal(view.container.querySelectorAll("button").length > 0, true);
    assert.equal(
      [...view.container.querySelectorAll("button")].filter(
        item => item.textContent === t("deleteJobRecord"),
      ).length,
      1,
    );
    const trigger = button(t("deleteJobRecord"), view.container);
    await click(trigger);
    const modal = document.querySelector('[role="dialog"]')!;
    assert.equal(modal.getAttribute("aria-modal"), "true");
    assert.match(modal.textContent!, /Failed lesson/);
    assert.match(modal.textContent!, /已建立的教材與備份會保留/);
    assert.equal(document.activeElement === button(t("cancel"), modal), true);
    assert.equal(calls, 0);
    await click(button(t("cancel"), modal));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(calls, 0);
    // Radix restores focus in a timer after the closing render commits.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(document.activeElement === trigger, true, "focus returns to the deletion trigger");
  } finally {
    await view.close();
  }
});

test("task disclosures open independently and stay expanded across progress refreshes", async () => {
  const jobs = [job("Running lesson", "running"), job("Failed lesson", "failed")];
  const view = await mount(<History jobs={jobs} />);
  try {
    const rows = [...view.container.querySelectorAll('[data-ui="taskHistoryItem"]')];
    const triggers = rows.map(row =>
      row.querySelector<HTMLButtonElement>("button[aria-expanded]")!,
    );
    const details = rows.map(row =>
      row.querySelector<HTMLElement>('[data-ui="taskHistoryDetails"]')!,
    );
    assert.ok(details.every(item => item.hidden));
    await click(triggers[0]);
    await click(triggers[1]);
    assert.ok(details.every(item => !item.hidden));
    await view.render(<History jobs={jobs.map(item => ({ ...item, completed: 2 }))} />);
    assert.ok(details.every(item => !item.hidden));
    assert.match(details[0].textContent!, /已完成 2／4 個生成步驟/);
    assert.equal(
      details[0].querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
      "50",
    );
    await click(triggers[0]);
    assert.equal(details[0].hidden, true);
    assert.equal(details[1].hidden, false);
  } finally {
    await view.close();
  }
});

test("generation progress keeps bulk clear enabled without refetching ended records", async () => {
  const ended = job("Saved lesson", "completed");
  const active = job("Running lesson", "running");
  let calls = 0;
  let complete!: (jobs: JobSummary[]) => void;
  const onListEnded = () => {
    calls++;
    return new Promise<JobSummary[]>(resolve => {
      complete = resolve;
    });
  };
  const onDeleteRecords = async (ids: string[]) => ({ deleted: ids, failed: [] });
  const view = await mount(
    <History jobs={[active, ended]} onListEnded={onListEnded} onDeleteRecords={onDeleteRecords} />,
  );
  try {
    assert.equal(button(t("clearEndedJobRecords"), view.container).disabled, true);
    await act(async () => complete([ended]));
    assert.equal(button(t("clearEndedJobRecords"), view.container).disabled, false);
    for (let progress = 1; progress <= 3; progress++) {
      await view.render(
        <History
          jobs={[
            { ...active, completed: progress, updatedAt: `2026-10-01T00:00:0${progress}.000Z` },
            { ...ended },
          ]}
          onListEnded={onListEnded}
          onDeleteRecords={onDeleteRecords}
        />,
      );
      assert.equal(
        button(t("clearEndedJobRecords"), view.container).disabled,
        false,
        "progress must not flash the clear button",
      );
      assert.equal(calls, 1, "progress does not change the ended-record set");
    }
    await view.render(
      <History
        jobs={[{ ...active, status: "completed" }, ended]}
        onListEnded={onListEnded}
        onDeleteRecords={onDeleteRecords}
      />,
    );
    assert.equal(calls, 2, "a newly ended task still refreshes the full record list");
    assert.equal(
      button(t("clearEndedJobRecords"), view.container).disabled,
      false,
      "background refresh keeps cached records usable",
    );
    await act(async () => complete([ended, { ...active, status: "completed" }]));
    await click(button(t("clearEndedJobRecords"), view.container));
    assert.match(document.querySelector('[role="dialog"]')!.textContent!, /清除 2 筆/);
    await click(button(t("cancel"), document.querySelector('[role="dialog"]')!));
  } finally {
    await view.close();
  }
});

test("manual refresh updates hidden ended records and resuming a task removes it from bulk clear", async () => {
  const ended = job("Saved lesson", "completed");
  const hidden = job("Older lesson", "failed");
  let records = [ended];
  let calls = 0;
  const onListEnded = async () => {
    calls++;
    return records;
  };
  let submitted: string[] = [];
  const onDeleteRecords = async (ids: string[]) => {
    submitted = ids;
    return { deleted: ids, failed: [] };
  };
  const view = await mount(
    <History jobs={[ended]} onListEnded={onListEnded} onDeleteRecords={onDeleteRecords} />,
  );
  try {
    records = [ended, hidden];
    await click(button(t("refreshJobs"), view.container));
    assert.equal(calls, 2);
    await click(button(t("clearEndedJobRecords"), view.container));
    assert.match(document.querySelector('[role="dialog"]')!.textContent!, /清除 2 筆/);
    await click(button(t("cancel"), document.querySelector('[role="dialog"]')!));
    records = [hidden];
    await view.render(
      <History
        jobs={[{ ...ended, status: "running" }]}
        onListEnded={onListEnded}
        onDeleteRecords={onDeleteRecords}
      />,
    );
    assert.equal(calls, 3);
    await click(button(t("clearEndedJobRecords"), view.container));
    assert.match(document.querySelector('[role="dialog"]')!.textContent!, /清除 1 筆/);
    await click(button(t("clearJobRecords"), document.querySelector('[role="dialog"]')!));
    assert.deepEqual(submitted, [hidden.id], "the resumed task must not be included in deletion");
  } finally {
    await view.close();
  }
});

test("bulk modal counts all ended records even those outside the visible page", async () => {
  const ended = Array.from({ length: 60 }, (_, i) =>
    job("Ended " + i, ["completed", "failed", "cancelled"][i % 3] as JobSummary["status"]),
  );
  let submitted: string[] = [];
  const view = await mount(
    <History
      jobs={[job("Active", "running"), ...ended.slice(0, 3)]}
      onListEnded={async () => ended}
      onDeleteRecords={async ids => {
        submitted = ids;
        return { deleted: ids, failed: [] };
      }}
    />,
  );
  try {
    await click(button(t("clearEndedJobRecords"), view.container));
    const modal = document.querySelector('[role="dialog"]')!;
    assert.match(modal.textContent!, /清除 60 筆/);
    assert.match(modal.textContent!, /已完成 20 筆 · 失敗 20 筆 · 已取消 20 筆/);
    assert.deepEqual(submitted, []);
    await click(button(t("clearJobRecords"), modal));
    assert.deepEqual(
      submitted,
      ended.map(item => item.id),
    );
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    await view.close();
  }
});

test("partial deletion keeps failures in the modal; pending deletion blocks dismissal and duplicate requests", async () => {
  const ended = [job("Done", "completed"), job("Failed", "failed")];
  const calls: string[][] = [];
  let finish!: (value: { deleted: string[]; failed: { jobId: string; message: string }[] }) => void;
  const view = await mount(
    <History
      jobs={ended}
      onListEnded={async () => ended}
      onDeleteRecords={ids => {
        calls.push(ids);
        return new Promise(resolve => {
          finish = resolve;
        });
      }}
    />,
  );
  try {
    await click(button(t("clearEndedJobRecords"), view.container));
    let modal = document.querySelector('[role="dialog"]')!;
    await click(button(t("clearJobRecords"), modal));
    assert.equal(button(t("deletingJobRecords"), modal).disabled, true);
    assert.equal(button(t("cancel"), modal).disabled, true);
    await act(async () => {
      document.activeElement!.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.equal(calls.length, 1);
    await act(async () => {
      finish({ deleted: ["Done"], failed: [{ jobId: "Failed", message: "Disk unavailable" }] });
    });
    modal = document.querySelector('[role="dialog"]')!;
    assert.match(modal.textContent!, /清除 1 筆/);
    assert.match(
      modal.querySelector('[role="alert"]')!.textContent!,
      /已刪除 1 筆紀錄，1 筆未能刪除.*Disk unavailable/,
    );
    await click(button(t("clearJobRecords"), modal));
    assert.deepEqual(calls, [["Done", "Failed"], ["Failed"]]);
    await act(async () => {
      finish({ deleted: ["Failed"], failed: [] });
    });
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    await view.close();
  }
});

test("empty history disables bulk clear and transport errors remain visible in the modal", async () => {
  const empty = await mount(
    <History
      jobs={[]}
      onListEnded={async () => []}
      onDeleteRecords={async ids => ({ deleted: ids, failed: [] })}
    />,
  );
  assert.equal(button(t("clearEndedJobRecords"), empty.container).disabled, true);
  await empty.close();
  const ended = [job("Failure", "failed")];
  const view = await mount(
    <History
      jobs={ended}
      onListEnded={async () => ended}
      onDeleteRecords={async () => {
        throw new Error("Host disconnected");
      }}
    />,
  );
  try {
    await click(button(t("deleteJobRecord"), view.container));
    await click(button(t("deleteJobRecord"), document.querySelector('[role="dialog"]')!));
    assert.match(
      document.querySelector('[role="dialog"] [role="alert"]')!.textContent!,
      /Host disconnected/,
    );
    assert.equal(
      button(t("deleteJobRecord"), document.querySelector('[role="dialog"]')!).disabled,
      false,
    );
  } finally {
    await view.close();
  }
});
