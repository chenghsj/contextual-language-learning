import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import type { LoopSettings, VideoAdapter } from "../video/types";
import { document as fixture } from "../../dev/reader-fixture";

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
  chrome: { storage: { local: { get: async () => ({}), set: async () => undefined } } },
});
dom.window.HTMLElement.prototype.scrollTo = () => undefined;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { ContextualSceneReader } = await import("../components/contextual-scene-reader");

function button(label: string, scope: ParentNode = document): HTMLButtonElement {
  const result = Array.from(scope.querySelectorAll("button")).find(
    item => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  assert.ok(result, label);
  return result;
}
async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}

test("one player changes target; timing transport is unbounded, previews are short, and Done persists", async () => {
  let currentMs = 1500,
    playing = false;
  let normalPlays = 0,
    pauses = 0,
    stops = 0;
  const loops: LoopSettings[] = [],
    saves: unknown[] = [],
    errors: string[] = [];
  const adapter: VideoAdapter = {
    id: "test",
    label: "Test",
    getVideoId: () => "test",
    status: async () => ({ currentMs, playing }),
    play: async () => {
      normalPlays++;
      playing = true;
    },
    pause: async () => {
      pauses++;
      playing = false;
    },
    seek: async (_url, ms) => {
      currentMs = ms;
    },
    loop: async (_url, range) => {
      loops.push(range);
      playing = true;
      currentMs = range.resumeMs ?? range.startMs;
    },
    stopLoop: async () => {
      stops++;
    },
    setPlaybackRate: async () => undefined,
  };
  const doc = {
    ...fixture,
    sections: [
      fixture.sections[0],
      { ...fixture.sections[0], id: "00000000-0000-4000-8000-000000000003", title: "Second scene" },
    ],
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ContextualSceneReader
        document={doc}
        adapter={adapter}
        locale="en"
        repeat="2"
        setRepeat={() => {}}
        delay={0}
        setDelay={() => {}}
        sceneRepeat="2"
        setSceneRepeat={() => {}}
        sceneDelay={0}
        setSceneDelay={() => {}}
        playbackRate={0.75}
        setPlaybackRate={() => {}}
        onNotice={() => {}}
        onError={message => errors.push(message)}
        onSaveRange={async (id, range) => {
          saves.push({ id, range });
        }}
        onSaveSceneRange={async () => {}}
      />,
    );
  });
  try {
    assert.equal(container.querySelectorAll('[data-ui="unifiedPlayer"]').length, 1);
    playing = true;
    await click(button("Next scene", container.querySelector("nav")!));
    assert.equal(loops.length, 0, "scene navigation never starts playback");
    assert.equal(playing, true, "browsing scenes preserves ordinary video playback");
    assert.equal(pauses, 0);
    assert.equal(stops, 0, "browsing does not issue playback commands");
    assert.equal(currentMs, 1500, "browsing does not seek");
    playing = false;
    await click(button("Previous scene", container.querySelector("nav")!));
    assert.equal(playing, false, "browsing preserves a paused video");
    assert.equal(pauses, 0);
    await click(button("Next scene", container.querySelector("nav")!));
    await click(button("Play whole conversation"));
    currentMs = 9000;
    await click(button("Previous scene", container.querySelector("nav")!));
    assert.equal(playing, false, "switching scenes stops managed practice playback");
    assert.equal(pauses, 1);
    await click(button("Next scene", container.querySelector("nav")!));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 350));
    });
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    assert.equal(
      slider.value,
      slider.min,
      "unplayed scene stays at its start after polling the old video position",
    );
    currentMs = 4000;
    await click(button("Previous scene", container.querySelector("nav")!));
    await click(button("Next scene", container.querySelector("nav")!));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 350));
    });
    assert.equal(
      slider.value,
      slider.min,
      "even an old position inside the new scene cannot become its progress",
    );
    await click(button("Play", container.querySelector("footer")!));
    assert.deepEqual(loops.at(-1), {
      startMs: 1000,
      endMs: 7500,
      repeats: 1,
      delaySeconds: 0,
      resumeMs: undefined,
    });
    await click(button("Pause", container.querySelector("footer")!));
    assert.ok(pauses > 0);
    await click(
      Array.from(container.querySelectorAll("button")).find(item =>
        item.textContent?.includes("I haven't decided"),
      )!,
    );
    assert.equal(loops.at(-1)?.startMs, 3100);
    assert.ok(button("Next sentence", container.querySelector("footer")!));
    currentMs = 4000;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 350));
    });
    await click(button("Pause", container.querySelector("footer")!));
    await click(button("Play", container.querySelector("footer")!));
    assert.equal(loops.at(-1)?.resumeMs, 4000, "resume starts at the paused video position");
    assert.equal(loops.at(-1)?.startMs, 3100, "resume preserves the repeat boundary");
    await click(button("Loop"));
    assert.equal(loops.at(-1)?.repeats, "infinite");
    assert.equal(button("Loop").getAttribute("aria-pressed"), "true");
    assert.equal(button("Loop").getAttribute("data-state"), "on");
    assert.match(container.querySelector('footer [role="status"]')!.textContent!, /Loop on/);
    await click(button("Loop"));
    assert.equal(button("Loop").getAttribute("aria-pressed"), "false");
    assert.equal(button("Loop").getAttribute("data-state"), "off");
    assert.equal(container.querySelector('footer [role="status"]'), null);
    await click(button("Loop"));
    assert.equal(loops.at(-1)?.startMs, 3100, "enabling loop preserves its full original range");
    await click(button("Previous scene", container.querySelector("nav")!));
    assert.equal(playing, false, "switching scenes stops sentence practice");
    assert.equal(
      button("Loop").getAttribute("aria-pressed"),
      "true",
      "scene navigation preserves the loop preference",
    );
    await click(button("Play", container.querySelector("footer")!));
    assert.equal(
      loops.at(-1)?.repeats,
      "infinite",
      "new scene playback uses the preserved loop preference",
    );
    await click(
      Array.from(container.querySelectorAll("button")).find(item =>
        item.textContent?.includes("I haven't decided"),
      )!,
    );
    await click(button("Playback options"));
    await click(button("Adjust timing"));
    assert.equal(saves.length, 0);
    await click(button("Pause", container.querySelector("section")!));
    await click(button("Play", container.querySelector("section")!));
    assert.equal(normalPlays, 1, "timing play uses native play, not the selected range");
    await click(button("End +0.5s"));
    await click(button("Test end"));
    assert.deepEqual(loops.at(-1), {
      startMs: 5000,
      endMs: 7000,
      repeats: 1,
      delaySeconds: 0,
      resumeMs: undefined,
    });
    assert.equal(saves.length, 0, "auditioning never writes lesson data");
    await click(button("Done"));
    assert.deepEqual(saves, [{ id: "cue-2", range: { startMs: 3100, endMs: 6000 } }]);
    await click(button("Playback options"));
    await click(button("Adjust timing"));
    await click(button("Start -0.1s"));
    await click(button("Reset timing"));
    assert.equal(saves.length, 1, "resetting a draft does not persist until Done");
    await click(button("Done"));
    assert.deepEqual(saves.at(-1), { id: "cue-2", range: null }, "reset removes adjusted timing");
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("platform navigation checks YouTube and Netflix; opening sidepanel does not check", async () => {
  const globals = globalThis as unknown as { chrome: typeof chrome };
  const original = globals.chrome;
  const { VIDEO_READER_VERSION } = await import("../video/reader-health");
  const { usePlatformVideoNotice } = await import("../hooks/use-platform-video-notice");
  let activated: () => void = () => {},
    updated: (id: number, change: { status?: string; url?: string }) => void = () => {};
  let tab = { id: 42, url: fixture.source.url!, status: "complete" };
  let probes = 0,
    healthy = false,
    reloads = 0,
    rejectReload = true;
  let controller: ReturnType<typeof usePlatformVideoNotice>;
  const notices: string[] = [];
  const notify = (message: string) => notices.push(message);
  globals.chrome = {
    ...original,
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      sendMessage: async () => {
        probes++;
        return {
          ok: healthy,
          platform: tab.url.includes("netflix") ? "netflix" : "youtube",
          bridgeVersion: VIDEO_READER_VERSION,
        };
      },
      reload: async (id: number) => {
        assert.equal(id, 43);
        reloads++;
        if (rejectReload) throw new Error("Reload failed");
      },
      onActivated: {
        addListener: (callback: typeof activated) => {
          activated = callback;
        },
        removeListener: () => {},
      },
      onUpdated: {
        addListener: (callback: typeof updated) => {
          updated = callback;
        },
        removeListener: () => {},
      },
    },
  } as unknown as typeof chrome;
  function Harness() {
    controller = usePlatformVideoNotice(notify, "reload");
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const event = async (action: () => void) => {
    await act(async () => {
      action();
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  };
  try {
    await act(async () => root.render(<Harness />));
    assert.equal(probes, 0, "mounting sidepanel must not probe");
    assert.deepEqual(notices, []);
    await event(() => updated(99, { status: "complete" }));
    assert.equal(probes, 0, "background tabs must not trigger checks");
    await event(activated);
    assert.equal(probes, 1);
    assert.deepEqual(
      notices,
      ["reload"],
      "switching to YouTube proactively notifies without playback",
    );
    assert.equal(controller!.unavailable?.id, 42);
    await act(async () => controller!.dismiss());
    assert.equal(Boolean(controller!.recovery), false);
    assert.equal(
      controller!.unavailable?.id,
      42,
      "closing the notice must not mark the reader healthy",
    );
    await event(activated);
    assert.deepEqual(notices, ["reload"], "same failure must not repeat");
    tab = { id: 43, url: "https://www.netflix.com/watch/12345678", status: "loading" };
    await event(activated);
    assert.equal(probes, 2, "loading video must wait");
    tab.status = "complete";
    await event(() => updated(43, { status: "complete" }));
    assert.deepEqual(notices, ["reload", "reload"], "Netflix navigation notifies after load");
    assert.equal(controller!.recovery?.id, 43);
    await act(async () => {
      await controller!.reload();
    });
    assert.equal(controller!.failed, true);
    assert.equal(controller!.recovery?.id, 43, "failed reload must retain recovery");
    rejectReload = false;
    await act(async () => {
      await controller!.reload();
      await controller!.reload();
    });
    assert.equal(reloads, 2, "busy reload must ignore repeated clicks");
    assert.equal(controller!.busy, true);
    healthy = true;
    await event(activated);
    assert.equal(controller!.recovery, null, "successful connection must close recovery");
    assert.equal(
      controller!.unavailable,
      null,
      "successful connection must unblock subtitle retrieval",
    );
    assert.equal(controller!.busy, false);
    assert.equal(notices.length, 2, "healthy page must not notify");
    tab = { id: 44, url: "https://example.com/", status: "complete" };
    const before = probes;
    await event(activated);
    assert.equal(probes, before, "unsupported pages must not be probed");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    globals.chrome = original;
  }
});

test("timeline advances between status polls and scrubbing commits only on release", async () => {
  const originalFrame = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  let frame: FrameRequestCallback | undefined;
  window.requestAnimationFrame = callback => {
    frame = callback;
    return 1;
  };
  window.cancelAnimationFrame = () => {
    frame = undefined;
  };
  let currentMs = 1000,
    playing = false;
  const loops: LoopSettings[] = [];
  const adapter: VideoAdapter = {
    id: "test",
    label: "Test",
    getVideoId: () => "test",
    status: async () => ({ currentMs, playing }),
    pause: async () => {
      playing = false;
    },
    seek: async () => {},
    loop: async (_url, range) => {
      loops.push(range);
      playing = true;
      currentMs = range.resumeMs ?? range.startMs;
    },
    stopLoop: async () => {},
    setPlaybackRate: async () => {},
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ContextualSceneReader
          document={fixture}
          adapter={adapter}
          locale="en"
          repeat="2"
          setRepeat={() => {}}
          delay={0}
          setDelay={() => {}}
          sceneRepeat="2"
          setSceneRepeat={() => {}}
          sceneDelay={0}
          setSceneDelay={() => {}}
          playbackRate={1}
          setPlaybackRate={() => {}}
          onNotice={() => {}}
          onError={() => {}}
          onSaveRange={async () => {}}
          onSaveSceneRange={async () => {}}
        />,
      ),
    );
    await click(button("Play", container.querySelector("footer")!));
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    const initial = Number(slider.value);
    await act(async () => {
      frame?.(performance.now() + 80);
    });
    assert.ok(Number(slider.value) > initial, "progress must move between the 300ms status polls");
    await act(async () => {
      frame?.(performance.now() + 1000);
    });
    assert.equal(
      Number(slider.value),
      initial + 300,
      "missing status samples must not allow unlimited extrapolation",
    );
    await act(async () => {
      slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
        slider,
        "4000",
      );
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(slider.value, "4000", "drag position updates immediately");
    assert.equal(loops.length, 1, "dragging does not repeatedly restart the video");
    await act(async () => {
      frame?.(performance.now() + 160);
    });
    assert.equal(slider.value, "4000", "playback updates cannot overwrite a drag");
    await act(async () => {
      slider.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    assert.equal(loops.length, 2);
    assert.equal(loops.at(-1)?.resumeMs, 4000);
    await act(async () => {
      slider.dispatchEvent(new Event("lostpointercapture", { bubbles: true }));
    });
    assert.equal(loops.length, 2, "losing capture after release must not seek twice");
    await click(button("Pause", container.querySelector("footer")!));
    const pausedPosition = slider.value;
    await act(async () => {
      frame?.(performance.now() + 500);
    });
    assert.equal(slider.value, pausedPosition, "paused progress must not advance");
    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    assert.equal(
      loops.at(-1)?.resumeMs,
      Number(pausedPosition) + 100,
      "keyboard seeking retains 0.1s steps",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.requestAnimationFrame = originalFrame;
    window.cancelAnimationFrame = originalCancel;
  }
});
