import assert from "node:assert/strict";
import test from "node:test";
import { detectCurrentVideoMetadata, metadataSourceSafety } from "./metadata-resolver";

const netflix = "https://www.netflix.com/watch/82036383";
const anotherNetflix = "https://www.netflix.com/watch/82036384";
const youtube = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

test("existing subtitles cannot be silently linked to a different video", () => {
  assert.equal(metadataSourceSafety(netflix, "WEBVTT\n\nHello", netflix), "safe");
  assert.equal(metadataSourceSafety(netflix, "WEBVTT\n\nHello", anotherNetflix), "mismatch");
  assert.equal(metadataSourceSafety(netflix, "WEBVTT\n\nHello", youtube), "mismatch");
  assert.equal(metadataSourceSafety("", "WEBVTT\n\nHello", netflix), "confirm");
  assert.equal(metadataSourceSafety("", "", netflix), "safe");
});

test("known source ID resolves its matching watch tab, not the unrelated active tab", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  let requestedTab = -1;
  try {
    globalChrome.chrome = {
      tabs: {
        query: async () => [
          { id: 7, url: youtube, active: true, windowId: 1 },
          { id: 8, url: netflix, title: "Netflix", active: false, windowId: 1 },
        ],
        get: async (id: number) => ({ id, url: netflix, title: "Netflix", windowId: 1 }),
        sendMessage: async (id: number) => {
          requestedTab = id;
          return { ok: true, url: netflix, title: "My Hero Academia - Netflix" };
        },
      },
    } as unknown as typeof chrome;
    const found = await detectCurrentVideoMetadata(netflix, 0);
    assert.equal(found?.url, netflix);
    assert.equal(found?.title, "My Hero Academia");
    assert.equal(requestedTab, 8);
  } finally {
    if (previous) globalChrome.chrome = previous;
    else delete globalChrome.chrome;
  }
});

test("with no source, detects the active supported video and tolerates missing title", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  try {
    globalChrome.chrome = {
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: {
        query: async () => [{ id: 9, url: netflix, title: "Netflix", active: true, windowId: 1 }],
        get: async () => ({ id: 9, url: netflix, title: "Netflix" }),
        sendMessage: async () => ({ ok: true, url: netflix, title: "Netflix" }),
      },
    } as unknown as typeof chrome;
    assert.deepEqual(await detectCurrentVideoMetadata("", 0), {
      tabId: 9, url: netflix, videoId: "82036383", platform: "netflix", title: null,
    });
  } finally {
    if (previous) globalChrome.chrome = previous;
    else delete globalChrome.chrome;
  }
});

test("rejects tab navigation during video metadata lookup", async () => {
  const globalChrome = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globalChrome.chrome;
  let reads = 0;
  try {
    globalChrome.chrome = {
      tabs: {
        query: async () => [{ id: 5, url: netflix, title: "Netflix", active: true }],
        get: async () => ({
          id: 5, url: ++reads === 1 ? netflix : anotherNetflix, title: "Netflix",
        }),
        sendMessage: async () => ({ ok: true, url: netflix, title: "Correct title" }),
      },
    } as unknown as typeof chrome;
    await assert.rejects(detectCurrentVideoMetadata(netflix, 0), /VIDEO_CHANGED/);
  } finally {
    if (previous) globalChrome.chrome = previous;
    else delete globalChrome.chrome;
  }
});
