import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Install DOM globals before importing Radix, which chooses its effect at load time.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true, url: "https://extension.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "MutationObserver", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
const React = await import("react");
const { act, useState } = React;
const { createRoot } = await import("react-dom/client");
const { TaskHistory } = await import("../components/task-history");
const { translate } = await import("./messages");
import type { JobSummary } from "@immersive/core";
const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("zh-TW", key, params);
const now = "2026-10-01T00:00:00.000Z";
function job(id: string, status: JobSummary["status"]): JobSummary {
  return { id, status, sourceTitle: id, provider: "openai", completed: 0, total: 4, createdAt: now, updatedAt: now };
}
async function mount(element: React.ReactNode) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, async close() { await act(async () => root.unmount()); container.remove(); } };
}
async function click(element: Element) {
  await act(async () => { (element as HTMLElement).focus(); (element as HTMLElement).click(); });
}
function button(label: string, parent: Element = document.body): HTMLButtonElement {
  const found = [...parent.querySelectorAll("button")].find(item => item.textContent === label);
  assert.ok(found, "Missing button: " + label);
  return found;
}
function History(props: Pick<React.ComponentProps<typeof TaskHistory>, "jobs" | "onListEnded" | "onDeleteRecords">) {
  return <TaskHistory {...props} locale="zh-TW" hostReady loadingJobs={false} generating={false} storageBusy={false}
    agentCatalog={[{ id: "openai", label: "OpenAI", installed: true, supportsAccountProfiles: false }]}
    t={t} onRefresh={() => undefined} onResume={() => undefined} onOpen={() => undefined}
    onRetryPublication={async () => undefined} onRetryBackup={async () => undefined} />;
}

test("single deletion requires confirmation, cancellation preserves records and focus", async () => {
  let calls = 0;
  const jobs = [job("Failed lesson", "failed"), job("Running lesson", "running")];
  const view = await mount(<History jobs={jobs} onListEnded={async () => [jobs[0]]}
    onDeleteRecords={async ids => { calls++; return { deleted: ids, failed: [] }; }} />);
  try {
    assert.equal(view.container.querySelectorAll("button").length > 0, true);
    assert.equal([...view.container.querySelectorAll("button")].filter(item => item.textContent === t("deleteJobRecord")).length, 1);
    const trigger = button(t("deleteJobRecord"), view.container);
    await click(trigger);
    const modal = document.querySelector('[role="dialog"]')!;
    assert.equal(modal.getAttribute("aria-modal"), "true");
    assert.match(modal.textContent!, /Failed lesson/);
    assert.match(modal.textContent!, /已建立的教材與備份會保留/);
    assert.equal(document.activeElement, button(t("cancel"), modal));
    assert.equal(calls, 0);
    await click(button(t("cancel"), modal));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(calls, 0);
    assert.equal(document.activeElement, trigger);
  } finally { await view.close(); }
});

test("bulk modal counts all ended records even those outside the visible page", async () => {
  const ended = Array.from({ length: 60 }, (_, i) => job("Ended " + i, ["completed", "failed", "cancelled"][i % 3] as JobSummary["status"]));
  let submitted: string[] = [];
  const view = await mount(<History jobs={[job("Active", "running"), ...ended.slice(0, 3)]}
    onListEnded={async () => ended} onDeleteRecords={async ids => { submitted = ids; return { deleted: ids, failed: [] }; }} />);
  try {
    await click(button(t("clearEndedJobRecords"), view.container));
    const modal = document.querySelector('[role="dialog"]')!;
    assert.match(modal.textContent!, /清除 60 筆/);
    assert.match(modal.textContent!, /已完成 20 筆 · 失敗 20 筆 · 已取消 20 筆/);
    assert.deepEqual(submitted, []);
    await click(button(t("clearJobRecords"), modal));
    assert.deepEqual(submitted, ended.map(item => item.id));
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await view.close(); }
});

test("partial deletion keeps failures in the modal; pending deletion blocks dismissal and duplicate requests", async () => {
  const ended = [job("Done", "completed"), job("Failed", "failed")];
  const calls: string[][] = [];
  let finish!: (value: { deleted: string[]; failed: { jobId: string; message: string }[] }) => void;
  const view = await mount(<History jobs={ended} onListEnded={async () => ended}
    onDeleteRecords={ids => { calls.push(ids); return new Promise(resolve => { finish = resolve; }); }} />);
  try {
    await click(button(t("clearEndedJobRecords"), view.container));
    let modal = document.querySelector('[role="dialog"]')!;
    await click(button(t("clearJobRecords"), modal));
    assert.equal(button(t("deletingJobRecords"), modal).disabled, true);
    assert.equal(button(t("cancel"), modal).disabled, true);
    await act(async () => { document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.equal(calls.length, 1);
    await act(async () => { finish({ deleted: ["Done"], failed: [{ jobId: "Failed", message: "Disk unavailable" }] }); });
    modal = document.querySelector('[role="dialog"]')!;
    assert.match(modal.textContent!, /清除 1 筆/);
    assert.match(modal.querySelector('[role="alert"]')!.textContent!, /已刪除 1 筆紀錄，1 筆未能刪除.*Disk unavailable/);
    await click(button(t("clearJobRecords"), modal));
    assert.deepEqual(calls, [["Done", "Failed"], ["Failed"]]);
    await act(async () => { finish({ deleted: ["Failed"], failed: [] }); });
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await view.close(); }
});

test("empty history disables bulk clear and transport errors remain visible in the modal", async () => {
  const empty = await mount(<History jobs={[]} onListEnded={async () => []} onDeleteRecords={async ids => ({ deleted: ids, failed: [] })} />);
  assert.equal(button(t("clearEndedJobRecords"), empty.container).disabled, true);
  await empty.close();
  const ended = [job("Failure", "failed")];
  const view = await mount(<History jobs={ended} onListEnded={async () => ended}
    onDeleteRecords={async () => { throw new Error("Host disconnected"); }} />);
  try {
    await click(button(t("deleteJobRecord"), view.container));
    await click(button(t("deleteJobRecord"), document.querySelector('[role="dialog"]')!));
    assert.match(document.querySelector('[role="dialog"] [role="alert"]')!.textContent!, /Host disconnected/);
    assert.equal(button(t("deleteJobRecord"), document.querySelector('[role="dialog"]')!).disabled, false);
  } finally { await view.close(); }
});
