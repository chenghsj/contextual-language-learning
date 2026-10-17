import React, { act } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { useJobHistoryRefresh } from "../hooks/use-job-history-refresh";

async function withHistory(
  load: () => Promise<void>,
  run: (
    history: () => ReturnType<typeof useJobHistoryRefresh>,
    errors: unknown[],
    rerender: (load: () => Promise<void>) => Promise<void>,
  ) => Promise<void>,
) {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const errors: unknown[] = [];
  let history!: ReturnType<typeof useJobHistoryRefresh>;
  function Harness({ load }: { load: () => Promise<void> }) {
    history = useJobHistoryRefresh(load, error => errors.push(error));
    return null;
  }
  const rerender = async (load: () => Promise<void>) => {
    await act(async () => root.render(<Harness load={load} />));
  };
  try {
    await rerender(load);
    await run(() => history, errors, rerender);
  } finally {
    await act(async () => root.unmount());
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

test("history replies broadcasting ready do not trigger another history request", async () => {
  let calls = 0;
  let status!: ReturnType<typeof useJobHistoryRefresh>["onConnectionStatus"];
  await withHistory(
    async () => {
      calls++;
      // Simulate the background controller's state broadcast after a jobs reply.
      if (calls < 10) status("ready");
    },
    async history => {
      status = history().onConnectionStatus;
      await act(async () => status("ready"));
      assert.equal(calls, 1);
      assert.equal(history().loading, false);
      await act(async () => {
        status("ready");
        status("ready");
      });
      assert.equal(calls, 1);
      await act(async () => {
        status("reconnecting");
        status("ready");
      });
      assert.equal(calls, 2, "a genuine reconnection still refreshes history");
    },
  );
});

test("manual and background refresh share one in-flight request across renders", async () => {
  let calls = 0;
  let complete!: () => void;
  await withHistory(
    () => {
      calls++;
      return new Promise<void>(resolve => (complete = resolve));
    },
    async (history, _errors, rerender) => {
      const subscribed = history();
      await act(async () => {
        void subscribed.refresh();
        subscribed.onConnectionStatus("ready");
        void subscribed.refresh();
      });
      assert.equal(calls, 1);
      assert.equal(history().loading, true);
      await act(async () => complete());
      assert.equal(history().loading, false);
      let latestCalls = 0;
      await rerender(async () => {
        latestCalls++;
      });
      await act(async () => subscribed.refresh());
      assert.equal(latestCalls, 1, "the original subscription uses the latest loader");
      assert.equal(history().loading, false);
    },
  );
});

test("a failed history request releases the refresh control for retry", async () => {
  const failure = new Error("Host unavailable");
  let calls = 0;
  await withHistory(
    async () => {
      if (++calls === 1) throw failure;
    },
    async (history, errors) => {
      await act(async () => history().refresh());
      assert.deepEqual(errors, [failure]);
      assert.equal(history().loading, false);
      await act(async () => history().refresh());
      assert.equal(calls, 2);
      assert.equal(history().loading, false);
    },
  );
});
