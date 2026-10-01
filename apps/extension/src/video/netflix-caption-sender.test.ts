import assert from "node:assert/strict";
import test from "node:test";
import { validateNetflixCaptionSender, type NetflixCaptionSender } from "./netflix-caption-sender";

const extensionId = "immersive-extension-test";
const watch = "https://www.netflix.com/watch/81234567";
const sender: NetflixCaptionSender = {
  id: extensionId,
  frameId: 0,
  tab: { id: 42 },
  url: watch,
  origin: "https://www.netflix.com",
};
const check = (candidate: NetflixCaptionSender, tabUrl = watch, videoId = "81234567") =>
  validateNetflixCaptionSender(candidate, extensionId, tabUrl, videoId);

test("accepts a top-level Netflix watch page caption request", () => {
  assert.equal(check(sender), null);
});

test("accepts a Netflix SPA content script loaded on /browse after tab navigates to /watch", () => {
  assert.equal(check({ ...sender, url: "https://www.netflix.com/browse" }), null);
  assert.equal(check({ ...sender, url: "https://www.netflix.com/watch/76543210" }), null);
});

test("uses the current tab URL and the requested video ID, not the sender's old document pathname", () => {
  assert.match(check(sender, "https://www.netflix.com/browse") ?? "", /not on a video watch page/);
  assert.match(check(sender, "https://www.netflix.com/watch/76543210") ?? "", /video changed/);
});

test("rejects cross-origin, impersonating and nested-frame caption requests", () => {
  assert.match(check({ ...sender, frameId: 1 }) ?? "", /top-level/);
  assert.match(check({ ...sender, id: "other-extension" }) ?? "", /this extension/);
  assert.match(check({ ...sender, url: "https://www.netflix.com.evil.test/browse" }) ?? "", /current Netflix page/);
  assert.match(check({ ...sender, url: "https://youtube.com/watch/81234567" }) ?? "", /current Netflix page/);
  assert.match(check({ ...sender, origin: "https://www.netflix.com.evil.test" }) ?? "", /document origin/);
  assert.match(check({ ...sender, url: "https://netflix.com/browse" }) ?? "", /current Netflix page/);
  assert.match(check({ ...sender, url: undefined, origin: undefined }) ?? "", /current Netflix page/);
});

test("origin alone is sufficient when Chrome omits the sender document URL", () => {
  assert.equal(check({ ...sender, url: undefined }), null);
});

test("the actual worker relay accepts an SPA /browse sender when the current tab is watching", async () => {
  const globals = globalThis as unknown as { chrome?: typeof chrome; fetch: typeof fetch };
  const previousChrome = globals.chrome;
  const previousFetch = globals.fetch;
  let messageListener: unknown;
  let currentTabUrl = watch;
  let networkCalls = 0;
  try {
    globals.chrome = {
      runtime: {
        id: extensionId,
        onMessage: { addListener: (fn: unknown) => { messageListener = fn; } },
      },
      tabs: { get: async (id: number) => ({ id, url: currentTabUrl }) },
      sidePanel: { setPanelBehavior: async () => {} },
      notifications: { onClicked: { addListener: () => {} }, onButtonClicked: { addListener: () => {} } },
    } as unknown as typeof chrome;
    globals.fetch = (async () => {
      networkCalls++;
      return new Response("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello.\n", { status: 200 });
    }) as typeof fetch;

    await import("../background");
    assert.equal(typeof messageListener, "function");
    const receive = messageListener as (
      message: unknown, source: chrome.runtime.MessageSender,
      respond: (response: { ok: boolean; text?: string; error?: string }) => void,
    ) => boolean;
    const source = { ...sender, url: "https://www.netflix.com/browse" } as chrome.runtime.MessageSender;
    const captionUrl = "https://ipv4-c001.nflxvideo.net/track.vtt?token=private";
    const request = (watchId: string) => new Promise<{ ok: boolean; text?: string; error?: string }>(resolve => {
      const pending = receive({ type: "NETFLIX_CAPTION_DOCUMENT_FETCH", url: captionUrl, watchId }, source, resolve);
      assert.equal(pending, true);
    });

    const allowed = await request("81234567");
    assert.equal(allowed.ok, true);
    assert.match(allowed.text ?? "", /WEBVTT/);
    assert.equal(networkCalls, 1);

    currentTabUrl = "https://www.netflix.com/watch/76543210";
    const changed = await request("81234567");
    assert.equal(changed.ok, false);
    assert.match(changed.error ?? "", /video changed/);
    assert.equal(networkCalls, 1);
  } finally {
    globals.fetch = previousFetch;
    if (previousChrome) globals.chrome = previousChrome;
    else delete globals.chrome;
  }
});
