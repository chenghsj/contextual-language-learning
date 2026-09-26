import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertVideoReaderReady, reloadExistingVideoTab } from "./tab";
import { RELOAD_READER_MESSAGE, VIDEO_READER_STATUS, VIDEO_READER_VERSION,
  needsVideoReaderReload } from "./reader-health";
import { subtitleAcquisition } from "../i18n/subtitle-acquisition";

const source = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const other = "https://www.youtube.com/watch?v=AAAAAAAAAAA";
const adapter = {
  id: "youtube", label: "YouTube",
  getVideoId: (url: string | undefined) => {
    try { return new URL(url ?? "").searchParams.get("v"); } catch { return null; }
  },
};

test("ready reader responds with matching platform and compiled bridge version", async () => {
  const globals = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globals.chrome;
  let sent: unknown;
  try {
    globals.chrome = { tabs: {
      get: async () => ({ id: 42, url: source }),
      sendMessage: async (_id: number, message: unknown) => {
        sent = message;
        return { ok: true, platform: "youtube", bridgeVersion: VIDEO_READER_VERSION };
      },
    } } as unknown as typeof chrome;
    await assertVideoReaderReady({ id: 42, url: source } as chrome.tabs.Tab, adapter);
    assert.deepEqual(sent, { type: VIDEO_READER_STATUS });
  } finally { globals.chrome = previous; }
});

test("missing, stale and mismatched readers fail fast with a reload action", async () => {
  const globals = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globals.chrome;
  try {
    for (const reply of [
      undefined,
      { ok: true, platform: "youtube", bridgeVersion: "outdated" },
      { ok: true, platform: "netflix", bridgeVersion: VIDEO_READER_VERSION },
    ]) {
      globals.chrome = { tabs: {
        get: async () => ({ id: 42, url: source }),
        sendMessage: async () => reply,
      } } as unknown as typeof chrome;
      await assert.rejects(
        () => assertVideoReaderReady({ id: 42, url: source } as chrome.tabs.Tab, adapter),
        error => error instanceof Error && error.message === RELOAD_READER_MESSAGE,
      );
    }
    assert.equal(needsVideoReaderReload(RELOAD_READER_MESSAGE), true);
    assert.equal(needsVideoReaderReload("The YouTube page has an outdated caption reader."), true);
    assert.equal(needsVideoReaderReload("影片分頁尚未載入擴充功能。"), true);
    assert.equal(needsVideoReaderReload("Netflix has no Japanese subtitles"), false);
  } finally { globals.chrome = previous; }
});

test("explicit recovery reloads only the matching original video tab", async () => {
  const globals = globalThis as unknown as { chrome?: typeof chrome };
  const previous = globals.chrome;
  const reloaded: number[] = [];
  try {
    globals.chrome = { tabs: {
      query: async () => [{ id: 7, url: other }, { id: 42, url: source }],
      get: async () => ({ id: 42, url: source }),
      reload: async (id: number) => { reloaded.push(id); },
      create: async () => { throw new Error("Must not open a new tab"); },
    } } as unknown as typeof chrome;
    await reloadExistingVideoTab(adapter, source);
    assert.deepEqual(reloaded, [42]);
    globals.chrome.tabs.get = async () => ({ id: 42, url: other }) as chrome.tabs.Tab;
    await assert.rejects(() => reloadExistingVideoTab(adapter, source), /影片分頁已切換/);
    assert.deepEqual(reloaded, [42]);
  } finally { globals.chrome = previous; }
});

test("both video content scripts verify the page-world reader before starting subtitle work", async () => {
  const [yt, ytPage, netflix, netflixPage, app] = await Promise.all([
    readFile(new URL("../content/youtube.ts", import.meta.url), "utf8"),
    readFile(new URL("../content/youtube-page.ts", import.meta.url), "utf8"),
    readFile(new URL("../content/netflix.ts", import.meta.url), "utf8"),
    readFile(new URL("../content/netflix-page.ts", import.meta.url), "utf8"),
    readFile(new URL("../App.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(yt, /message.type === VIDEO_READER_STATUS/);
  assert.match(ytPage, /HEALTH_REQUEST/);
  assert.match(ytPage, /HEALTH_RESPONSE/);
  assert.match(netflix, /candidate.type === VIDEO_READER_STATUS/);
  assert.match(netflixPage, /request.action === "bridgeHealth"/);
  assert.match(app, /await assertVideoReaderReady\(tab, adapter\)/);
  assert.match(app, /reloadExistingVideoTab\(getVideoAdapter\(videoRecoveryUrl\), videoRecoveryUrl\)/);
});

test("all interface languages explain manual recovery without suggesting another tab", () => {
  for (const [locale, copy] of Object.entries(subtitleAcquisition)) {
    assert.ok(copy.reloadTab.trim(), locale);
    assert.ok(copy.reloadingTab.trim(), locale);
    assert.ok(copy.reloadedTab.trim(), locale);
    assert.ok(copy.reloadFailed.trim(), locale);
  }
});

test("Netflix subtitle bridge has room for track discovery, worker fetch and a full response", async () => {
  const [isolated, page, youTube, youTubePage] = await Promise.all([
    readFile(new URL("../content/netflix.ts", import.meta.url), "utf8"),
    readFile(new URL("../content/netflix-page.ts", import.meta.url), "utf8"),
    readFile(new URL("../content/youtube.ts", import.meta.url), "utf8"),
    readFile(new URL("../content/youtube-page.ts", import.meta.url), "utf8"),
  ]);
  assert.match(isolated, /action === "subtitlesGet" \? 22_000/);
  assert.match(page, /12_500/);
  assert.match(isolated, /Netflix subtitle retrieval timed out/);
  assert.match(page, /chosen\?\.player \?\? \{\}, video/);
  assert.match(isolated, /netflix-worker-url-check-v3/);
  assert.match(page, /netflix-worker-url-check-v3/);
  assert.match(youTube, /native-caption-capture-v2/);
  assert.match(youTubePage, /native-caption-capture-v2/);
  assert.equal(VIDEO_READER_VERSION, "reader-health-v2");
  assert.ok(1_200 + 3_000 + 12_500 < 22_000);
});
