import React, { act } from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { NotificationSettings } from "../components/notification-settings";

test("notification preferences remain separate from permission; testing reports denial, success and API failure", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test" });
  let permission = "denied",
    sent = 0,
    failure = false;
  let now = 0,
    nextTimer = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  dom.window.setTimeout = ((callback: () => void, delay: number) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + delay, callback });
    return id;
  }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = (id: number | undefined) => {
    if (id !== undefined) timers.delete(id);
  };
  async function advance(ms: number): Promise<void> {
    now += ms;
    await act(async () => {
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
    });
  }
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      runtime: { getURL: (path: string) => path },
      notifications: {
        getPermissionLevel: async () => permission,
        create: async () => {
          if (failure) throw new Error("failed");
          sent++;
        },
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const changes: boolean[] = [];
  try {
    await act(async () =>
      root.render(
        <NotificationSettings
          locale="zh-TW"
          completed
          attention
          onCompleted={value => changes.push(value)}
          onAttention={() => {}}
        />,
      ),
    );
    assert.match(container.textContent!, /系統目前不允許通知/);
    const switches = container.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    assert.equal(switches.length, 2);
    assert.equal(switches[0].getAttribute("aria-checked"), "true");
    await act(async () => switches[0].click());
    assert.deepEqual(changes, [false]);
    const testButton = Array.from(container.querySelectorAll("button")).find(
      button => button.textContent === "傳送測試通知",
    )!;
    await act(async () => testButton.click());
    assert.equal(sent, 0);
    assert.match(container.textContent!, /無法傳送測試通知/);
    await advance(5_000);
    assert.match(container.textContent!, /無法傳送測試通知/);
    permission = "granted";
    await act(async () => testButton.click());
    assert.equal(sent, 1);
    assert.match(container.textContent!, /測試通知已傳送/);
    assert.doesNotMatch(container.textContent!, /系統目前不允許通知/);
    await advance(4_000);
    assert.match(container.textContent!, /測試通知已傳送/);
    await act(async () => testButton.click());
    assert.equal(sent, 2);
    await advance(1_000);
    assert.match(container.textContent!, /測試通知已傳送/);
    await advance(4_000);
    assert.doesNotMatch(container.textContent!, /測試通知已傳送/);
    const statusRegion = container.querySelector('[role="status"]')!;
    assert.equal(statusRegion.textContent, "");
    assert.ok(statusRegion.classList.contains("min-h-4"));
    await act(async () => testButton.click());
    failure = true;
    await act(async () => testButton.click());
    assert.match(container.textContent!, /無法傳送測試通知/);
    await advance(5_000);
    assert.match(container.textContent!, /無法傳送測試通知/);
    assert.equal(testButton.disabled, false);
    failure = false;
    await act(async () => testButton.click());
    assert.equal(timers.size, 1);
  } catch (error) {
    if (error instanceof AggregateError) throw new Error(error.errors.map(String).join("\n"));
    throw error;
  } finally {
    await act(async () => root.unmount());
    assert.equal(timers.size, 0);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
