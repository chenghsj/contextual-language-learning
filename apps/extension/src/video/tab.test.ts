import { VIDEO_COMMAND_ERROR_CODES, isVideoCommandErrorCode } from "./command-errors";
import assert from "node:assert/strict";
import test from "node:test";
import { netflixAdapter } from "./netflix";
import { youtubeAdapter } from "./youtube";
import {
  CUE_LEAD_IN_MS,
  CUE_TAIL_MS,
  cuePlaybackStart,
  cuePlaybackWindow,
  findVideoTab,
  getActiveWindowTab,
  openOrFocusVideoTab,
  sendToVideo,
  VideoCommandError,
} from "./tab";

const url = "https://www.netflix.com/watch/81234567";
const other = "https://www.netflix.com/watch/76543210";

type ChromeApi = typeof chrome;
type MockTab = { id: number; url: string; active: boolean; windowId: number };
const tab = (id: number, active: boolean, windowId: number, source = url): MockTab => ({
  id,
  active,
  windowId,
  url: source,
});

async function withChrome(
  handlers: {
    tabs: MockTab[];
    current: MockTab[];
    reply?: { ok: boolean; error?: string; errorCode?: string };
    onCreate?: (url: string) => void;
    onUpdate?: (id: number) => void;
    onMessage?: (id: number, message: unknown) => void;
  },
  run: () => Promise<void>,
): Promise<void> {
  const globalChrome = globalThis as unknown as { chrome?: ChromeApi };
  const previous = globalChrome.chrome;
  try {
    globalChrome.chrome = {
      tabs: {
        query: async (info: chrome.tabs.QueryInfo) =>
          info.active && (info.currentWindow || info.windowId === 1 || info.lastFocusedWindow)
            ? handlers.current
            : handlers.tabs,
        create: async (info: chrome.tabs.CreateProperties) => {
          handlers.onCreate?.(info.url ?? "");
          const created = tab(99, true, 1, info.url);
          handlers.tabs.push(created);
          return created;
        },
        update: async (id: number) => {
          handlers.onUpdate?.(id);
          return handlers.tabs.find(item => item.id === id);
        },
        sendMessage: async (id: number, message: unknown) => {
          handlers.onMessage?.(id, message);
          return handlers.reply ?? { ok: true };
        },
      },
      windows: { getCurrent: async () => ({ id: 1 }), update: async () => ({}) },
    } as unknown as ChromeApi;
    await run();
  } finally {
    globalChrome.chrome = previous;
  }
}

test("two matching Netflix tabs: prefer the active tab in the current window, not the first match", async () => {
  const first = tab(10, false, 1);
  const selected = tab(11, true, 1);
  const sent: number[] = [];
  const activated: number[] = [];
  let opened = 0;
  await withChrome(
    {
      tabs: [first, selected],
      current: [selected],
      onMessage: id => sent.push(id),
      onUpdate: id => activated.push(id),
      onCreate: () => {
        opened++;
      },
    },
    async () => {
      assert.equal((await findVideoTab(netflixAdapter, url)).id, 11);
      await sendToVideo(netflixAdapter, url, { type: "NETFLIX_DIAGNOSE" }, true);
      const result = await openOrFocusVideoTab(netflixAdapter, url);
      assert.equal(result.reused, true);
      assert.equal(result.tab.id, 11);
    },
  );
  assert.deepEqual(sent, [11]);
  assert.deepEqual(activated, [11, 11]);
  assert.equal(opened, 0);
});

test("ambiguous duplicates without a selected matching tab fail safely and never open a third tab", async () => {
  const first = tab(10, true, 1);
  const second = tab(11, true, 2);
  const unrelated = tab(7, true, 3, other);
  let opened = 0;
  let messaged = 0;
  await withChrome(
    {
      tabs: [first, second, unrelated],
      current: [unrelated],
      onCreate: () => {
        opened++;
      },
      onMessage: () => {
        messaged++;
      },
    },
    async () => {
      await assert.rejects(findVideoTab(netflixAdapter, url), /多個分頁/);
      await assert.rejects(openOrFocusVideoTab(netflixAdapter, url), /多個分頁/);
      await assert.rejects(
        sendToVideo(netflixAdapter, url, { type: "NETFLIX_SEEK", timeMs: 5000 }),
        /多個分頁/,
      );
    },
  );
  assert.equal(opened, 0);
  assert.equal(messaged, 0);
});

test("reuse an existing matching tab, even when another Netflix title is active", async () => {
  const matching = tab(12, false, 1);
  const unrelated = tab(13, true, 1, other);
  let created = 0;
  const activated: number[] = [];
  await withChrome(
    {
      tabs: [matching, unrelated],
      current: [unrelated],
      onCreate: () => {
        created++;
      },
      onUpdate: id => activated.push(id),
    },
    async () => {
      const result = await openOrFocusVideoTab(netflixAdapter, url);
      assert.equal(result.reused, true);
      assert.equal(result.tab.id, 12);
    },
  );
  assert.equal(created, 0);
  assert.deepEqual(activated, [12]);
});

test("open one watch tab if absent; a later request reuses it", async () => {
  const openUrls: string[] = [];
  const activated: number[] = [];
  const state = { tabs: [tab(7, true, 1, other)], current: [tab(7, true, 1, other)] };
  await withChrome(
    {
      ...state,
      onCreate: url => openUrls.push(url),
      onUpdate: id => activated.push(id),
    },
    async () => {
      const created = await openOrFocusVideoTab(netflixAdapter, url);
      assert.equal(created.reused, false);
      const reused = await openOrFocusVideoTab(netflixAdapter, url);
      assert.equal(reused.reused, true);
      assert.equal(reused.tab.id, created.tab.id);
    },
  );
  assert.deepEqual(openUrls, [url]);
  assert.deepEqual(activated, [99]);
});

test("missing content script advises reloading the original tab, not opening a duplicate", async () => {
  const current = tab(22, true, 1);
  await withChrome({ tabs: [current], current: [current] }, async () => {
    const globalChrome = globalThis as unknown as { chrome: ChromeApi };
    globalChrome.chrome.tabs.sendMessage = async () => {
      throw new Error("Could not establish connection. Receiving end does not exist.");
    };
    await assert.rejects(
      sendToVideo(netflixAdapter, url, { type: "NETFLIX_DIAGNOSE" }),
      /重新整理原本的影片分頁/,
    );
  });
});

test("malformed or impersonating Netflix URLs are rejected before opening any tab", async () => {
  const current = tab(22, true, 1);
  let created = 0;
  await withChrome(
    {
      tabs: [current],
      current: [current],
      onCreate: () => {
        created++;
      },
    },
    async () => {
      await assert.rejects(
        openOrFocusVideoTab(netflixAdapter, "https://www.netflix.com.evil.example/watch/81234567"),
        /網址無效/,
      );
    },
  );
  assert.equal(created, 0);
});

test("active Side Panel tab is resolved from its hosting window, not another window", async () => {
  const current = tab(44, true, 1, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const otherWindow = tab(45, true, 2);
  await withChrome({ tabs: [otherWindow, current], current: [current] }, async () => {
    assert.equal((await getActiveWindowTab())?.id, 44);
  });
});

test("a form URL can find its matching watch tab without using the unrelated active tab", async () => {
  const selected = tab(12, true, 1, other);
  const wanted = tab(13, false, 1, url);
  const received: number[] = [];
  await withChrome(
    {
      tabs: [selected, wanted],
      current: [selected],
      onMessage: id => received.push(id),
    },
    async () => {
      assert.equal((await findVideoTab(netflixAdapter, url)).id, 13);
      await sendToVideo(netflixAdapter, url, { type: "NETFLIX_SUBTITLES_GET", language: "en" });
    },
  );
  assert.deepEqual(received, [13]);
});

test("subtitle playback has half a second of lead-in and a short tail without seeking before zero", () => {
  assert.equal(CUE_LEAD_IN_MS, 500);
  assert.equal(CUE_TAIL_MS, 400);
  assert.equal(cuePlaybackStart(84_000), 83_500);
  assert.equal(cuePlaybackStart(500), 0);
  assert.deepEqual(cuePlaybackWindow(84_000, 85_200), { startMs: 83_500, endMs: 85_600 });
  assert.throws(() => cuePlaybackWindow(2000, 2000), /Invalid subtitle end/);
});

test("opening a timestamp link reuses an existing watch tab instead of opening another", async () => {
  const current = tab(51, true, 1, other);
  const playing = tab(52, false, 1, url);
  let opened = 0;
  const focused: number[] = [];
  await withChrome(
    {
      tabs: [current, playing],
      current: [current],
      onCreate: () => {
        opened++;
      },
      onUpdate: id => focused.push(id),
    },
    async () => {
      const result = await openOrFocusVideoTab(netflixAdapter, url + "?t=82");
      assert.equal(result.reused, true);
      assert.equal(result.tab.id, 52);
    },
  );
  assert.equal(opened, 0);
  assert.deepEqual(focused, [52]);
});

test("YouTube direct seek targets only its matching existing video tab", async () => {
  const watchUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const wanted = tab(62, false, 1, watchUrl);
  const unrelated = tab(63, true, 1, "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  const sent: { id: number; message: unknown }[] = [];
  await withChrome(
    {
      tabs: [wanted, unrelated],
      current: [unrelated],
      onMessage: (id, message) => sent.push({ id, message }),
    },
    async () => {
      await youtubeAdapter.seek?.(watchUrl, 83_500);
    },
  );
  assert.deepEqual(sent, [{ id: 62, message: { type: "YOUTUBE_SEEK", timeMs: 83_500 } }]);
});

test("video failures preserve known error codes and reject unknown transport codes", async () => {
  for (const code of [...VIDEO_COMMAND_ERROR_CODES, "UNTRUSTED_CODE"]) {
    await withChrome(
      {
        tabs: [tab(1, true, 1)],
        current: [],
        reply: { ok: false, error: "Technical diagnostic", errorCode: code },
      },
      async () => {
        await assert.rejects(sendToVideo(netflixAdapter, url, { type: "SUBTITLES_GET" }), error => {
          assert.ok(error instanceof VideoCommandError);
          assert.equal(error.code, isVideoCommandErrorCode(code) ? code : undefined);
          return true;
        });
      },
    );
  }
});
