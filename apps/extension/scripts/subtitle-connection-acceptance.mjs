// Actual App and subtitle editor, with controlled browser playback responses.
import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 5188, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
  await page.addInitScript(() => {
    let browserApi;
    window.playbackFixture = { ready: false, durationMs: undefined, seekRequests: [] };
    Object.defineProperty(window, "chrome", {
      configurable: true,
      get: () => browserApi,
      set: value => {
        const original = value.tabs.sendMessage;
        value.tabs.sendMessage = async (id, message) => {
          const fixture = window.playbackFixture;
          if (message.type === "PLAYBACK_STATUS_GET") {
            if (!fixture.ready) throw new Error("Video player is not ready");
            return { ok: true, currentMs: 5000, durationMs: fixture.durationMs, playing: false };
          }
          if (message.type === "YOUTUBE_SEEK") fixture.seekRequests.push(message.timeMs);
          return original(id, message);
        };
        browserApi = value;
      },
    });
  });
  await page.goto("http://127.0.0.1:5188/dev/redesign-preview.html?captions=early-ending");
  await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
  await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
  const time = page.locator('[data-ui="subtitle-editor"] li button').first();
  assert.equal(await time.isEnabled(), false, "an unavailable player disables seeking");
  await page.evaluate(() => {
    window.playbackFixture.ready = true;
  });
  await page.waitForFunction(
    () => {
      const time = document.querySelector('[data-ui="subtitle-editor"] li button');
      return time && !time.disabled;
    },
    null,
    { timeout: 6000 },
  );
  await time.click();
  await page.waitForFunction(() => window.playbackFixture.seekRequests.includes(8040));
  assert.equal(
    await page.evaluate(() => window.playbackFixture.durationMs),
    undefined,
    "seeking recovers even before the player reports its duration",
  );
  await page.evaluate(() => {
    window.playbackFixture.ready = false;
  });
  await page.waitForFunction(
    () => document.querySelector('[data-ui="subtitle-editor"] li button')?.disabled,
    null,
    { timeout: 6000 },
  );
  await page.evaluate(() => {
    window.playbackFixture.ready = true;
    window.playbackFixture.durationMs = 30000;
    chrome.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
  });
  await page.waitForFunction(
    () => {
      const time = document.querySelector('[data-ui="subtitle-editor"] li button');
      return time && !time.disabled;
    },
    null,
    { timeout: 6000 },
  );
  await time.click();
  await page.waitForFunction(() => window.playbackFixture.seekRequests.length === 2);
  console.log(
    "PASS: timestamps recover after initial failure and later disconnection without reopening; seek works without duration.",
  );
} finally {
  await browser?.close();
  await server.close();
}
