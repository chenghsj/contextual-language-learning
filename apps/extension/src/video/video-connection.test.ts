import React, { act } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { useVideoConnection } from "../hooks/use-video-connection";
import type { VideoAdapter } from "./types";

async function withConnection(
  status: NonNullable<VideoAdapter["status"]>,
  run: (fixture: {
    state: () => ReturnType<typeof useVideoConnection>;
    poll: () => Promise<void>;
    source: (url: string) => Promise<void>;
  }) => Promise<void>,
) {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const intervals = new Map<number, () => void>();
  let timerId = 0;
  dom.window.setInterval = ((fn: () => void) => {
    intervals.set(++timerId, fn);
    return timerId;
  }) as typeof dom.window.setInterval;
  dom.window.clearInterval = (id: number | undefined) => {
    intervals.delete(id!);
  };
  const listeners = new Set<() => void>();
  const event = {
    addListener: (fn: () => void) => listeners.add(fn),
    removeListener: (fn: () => void) => listeners.delete(fn),
  };
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    chrome: { tabs: { onActivated: event, onUpdated: event } },
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const adapter: VideoAdapter = {
    id: "youtube",
    label: "YouTube",
    getVideoId: url => url ?? null,
    status,
  };
  let state!: ReturnType<typeof useVideoConnection>;
  function Harness({ url }: { url: string }) {
    state = useVideoConnection(adapter, url);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const source = async (url: string) => {
    await act(async () => root.render(React.createElement(Harness, { url })));
  };
  try {
    await source("first");
    await run({
      state: () => state,
      source,
      poll: async () => {
        await act(async () => {
          for (const poll of intervals.values()) poll();
        });
      },
    });
  } finally {
    await act(async () => root.unmount());
    assert.equal(intervals.size, 0);
    assert.equal(listeners.size, 0);
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}

test("playback readiness recovers without duration and invalid status does not enable seeking", async () => {
  let reply: Awaited<ReturnType<NonNullable<VideoAdapter["status"]>>> | undefined;
  await withConnection(
    async () => {
      if (!reply) throw new Error("Not ready");
      return reply;
    },
    async fixture => {
      assert.equal(fixture.state().connected, false);
      reply = { currentMs: 0 };
      await fixture.poll();
      assert.deepEqual(fixture.state(), { connected: true, durationMs: undefined });
      reply = { currentMs: 100, durationMs: 30000 };
      await fixture.poll();
      assert.equal(fixture.state().durationMs, 30000);
      for (const currentMs of [undefined, NaN, -1]) {
        reply = { currentMs };
        await fixture.poll();
        assert.equal(fixture.state().connected, false);
        assert.equal(fixture.state().durationMs, 30000, "known duration survives a disconnection");
      }
    },
  );
});

test("requests do not overlap and old video responses cannot connect a new source", async () => {
  let calls = 0;
  let resolveFirst!: (value: { currentMs: number; durationMs: number }) => void;
  await withConnection(
    url => {
      calls++;
      if (url === "first")
        return new Promise(resolve => {
          resolveFirst = resolve;
        });
      return Promise.resolve({ currentMs: 0 });
    },
    async fixture => {
      await fixture.poll();
      await fixture.poll();
      assert.equal(calls, 1);
      await fixture.source("second");
      assert.equal(calls, 2);
      assert.deepEqual(fixture.state(), { connected: true, durationMs: undefined });
      await act(async () => resolveFirst({ currentMs: 5000, durationMs: 90000 }));
      assert.deepEqual(fixture.state(), { connected: true, durationMs: undefined });
    },
  );
});

test("a stalled status request times out and releases the next recovery check", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  await withConnection(
    () => {
      if (++calls === 1) return new Promise(() => {});
      return Promise.resolve({ currentMs: 0, durationMs: 30000 });
    },
    async fixture => {
      await act(async () => context.mock.timers.tick(2200));
      assert.equal(fixture.state().connected, false);
      await fixture.poll();
      assert.equal(calls, 2);
      assert.equal(fixture.state().connected, true);
    },
  );
});
