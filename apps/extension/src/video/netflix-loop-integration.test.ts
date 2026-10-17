import assert from "node:assert/strict";
import test from "node:test";

type RuntimeHandler = (
  message: unknown,
  sender: unknown,
  respond: (result: { ok: boolean; error?: string }) => void,
) => boolean;

class TestCustomEvent<T> extends Event {
  detail: T;
  constructor(name: string, options: { detail: T }) {
    super(name);
    this.detail = options.detail;
  }
}

test("Netflix replay survives its own seeking/pause events before currentTime changes", async () => {
  const globals = globalThis as unknown as {
    window?: Window;
    document?: Document;
    location?: Location;
    chrome?: typeof chrome;
    CustomEvent?: typeof CustomEvent;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  };
  const old = {
    window: globals.window,
    document: globals.document,
    location: globals.location,
    chrome: globals.chrome,
    CustomEvent: globals.CustomEvent,
    setInterval: globals.setInterval,
    clearInterval: globals.clearInterval,
  };
  const windowEvents = new EventTarget();
  const video = new EventTarget() as HTMLVideoElement;
  Object.assign(video, {
    currentTime: 10,
    paused: false,
    ended: false,
    seeking: false,
    isConnected: true,
  });
  const calls: string[] = [];
  let handler: RuntimeHandler | undefined;
  let tick: (() => void) | undefined;
  let intervalsCleared = 0;

  try {
    globals.CustomEvent = TestCustomEvent as unknown as typeof CustomEvent;
    globals.window = windowEvents as unknown as Window;
    globals.location = {
      pathname: "/watch/81234567",
      href: "https://www.netflix.com/watch/81234567",
    } as unknown as Location;
    globals.document = {
      querySelectorAll: () => [video],
    } as unknown as Document;
    globals.chrome = {
      runtime: {
        onMessage: {
          addListener: (fn: RuntimeHandler) => {
            handler = fn;
          },
        },
      },
    } as unknown as typeof chrome;
    globals.setInterval = ((callback: () => void) => {
      tick = callback;
      return 17;
    }) as typeof setInterval;
    globals.clearInterval = (() => {
      intervalsCleared++;
    }) as typeof clearInterval;

    windowEvents.addEventListener("contextual-learning:netflix:request", event => {
      const req = (event as TestCustomEvent<{ id: string; action: string; value?: number }>).detail;
      calls.push(req.action);
      const result: Record<string, unknown> = {
        source: "contextual-learning",
        id: req.id,
        ok: true,
        available: true,
      };
      if (req.action === "seekTo") {
        // Netflix dispatches seeking/pause with the OLD time before its internal
        // player applies the new cursor. Neither event is a manual interruption.
        video.dispatchEvent(new Event("seeking"));
        Object.assign(video, { paused: true, seeking: true });
        video.dispatchEvent(new Event("pause"));
        video.currentTime = (req.value ?? 0) / 1000;
        Object.assign(video, { seeking: false, paused: true });
        video.dispatchEvent(new Event("seeked"));
        // Some Netflix sessions emit a transient pause and another seeking
        // event after the cursor reaches its target but before play resumes.
        video.dispatchEvent(new Event("pause"));
        video.dispatchEvent(new Event("seeking"));
        result.seekCalled = true;
      }
      if (req.action === "play") Object.assign(video, { paused: false });
      if (req.action === "pause") {
        Object.assign(video, { paused: true });
        video.dispatchEvent(new Event("pause"));
      }
      if (req.action === "diagnose") result.currentMs = video.currentTime * 1000;
      windowEvents.dispatchEvent(
        new TestCustomEvent("contextual-learning:netflix:response", {
          detail: result,
        }),
      );
    });

    await import("../content/netflix");
    assert.ok(handler, "content script did not register its playback handler");
    const run = (message: unknown) =>
      new Promise<{ ok: boolean; error?: string }>(resolve => {
        const asyncReply = handler!(message, {}, resolve);
        assert.equal(asyncReply, true);
      });
    assert.equal(
      (
        await run({
          type: "NETFLIX_LOOP_SET",
          startMs: 60_000,
          endMs: 61_000,
          repeats: 2,
          delaySeconds: 0,
        })
      ).ok,
      true,
    );
    assert.equal(typeof tick, "function");
    assert.deepEqual(
      calls.filter(action => action === "seekTo"),
      ["seekTo"],
    );

    video.currentTime = 61.0;
    tick!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(
      calls.filter(action => action === "seekTo"),
      ["seekTo", "seekTo"],
    );
    assert.equal(video.currentTime, 60);

    video.currentTime = 61.0;
    tick!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(
      calls.filter(action => action === "seekTo"),
      ["seekTo", "seekTo"],
    );
    assert.ok(intervalsCleared >= 1, "finite loop did not stop after two playthroughs");
    assert.equal(video.paused, true, "finite playback must pause at the final boundary");
    assert.equal(calls.filter(action => action === "pause").length, 1);

    assert.equal(
      (
        await run({
          type: "NETFLIX_LOOP_SET",
          startMs: 60_000,
          endMs: 61_000,
          repeats: 1,
          delaySeconds: 0,
        })
      ).ok,
      true,
    );
    video.currentTime = 60.8;
    tick!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(video.paused, false, "single-sentence playback must not pause before its end");
    video.currentTime = 61;
    tick!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(video.paused, true, "a single sentence must pause at its end");
    assert.equal(calls.filter(action => action === "pause").length, 2);
    tick!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(
      calls.filter(action => action === "pause").length,
      2,
      "finished playback must release its timer",
    );

    assert.equal(
      (
        await run({
          type: "NETFLIX_LOOP_SET",
          startMs: 60_000,
          endMs: 61_000,
          repeats: "infinite",
          delaySeconds: 0,
        })
      ).ok,
      true,
    );
    video.currentTime = 61;
    tick!();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(video.currentTime, 60);
    assert.equal(video.paused, false, "infinite looping must continue playing");
    assert.equal(calls.filter(action => action === "pause").length, 2);
  } finally {
    windowEvents.dispatchEvent(new Event("pagehide"));
    globals.setInterval = old.setInterval;
    globals.clearInterval = old.clearInterval;
    if (old.window) globals.window = old.window;
    else delete globals.window;
    if (old.document) globals.document = old.document;
    else delete globals.document;
    if (old.location) globals.location = old.location;
    else delete globals.location;
    if (old.chrome) globals.chrome = old.chrome;
    else delete globals.chrome;
    if (old.CustomEvent) globals.CustomEvent = old.CustomEvent;
    else delete globals.CustomEvent;
  }
});
