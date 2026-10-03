import { chromium } from "playwright";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Real App and worker; video and Host responses use the development fixture.
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { host: "127.0.0.1", port: 5177, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:5177/dev/redesign-preview.html");
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.evaluate(() => {
      const original = chrome.tabs.sendMessage;
      window.captionRequests = [];
      chrome.tabs.sendMessage = async (id, message) => {
        if (message.type === "YOUTUBE_SUBTITLES_GET") {
          window.captionRequests.push(message.language);
          return { ok: false, error: "Missing track", errorCode: "TRACK_UNAVAILABLE" };
        }
        return original(id, message);
      };
    });
    // Exercise the reported old path as well as the selector's new first-step location.
    if (!(await page.locator("#learning-target").isVisible())) {
      await page.getByRole("button", { name: "4. 設定與 Prompt", exact: true }).click();
    }
    await page.locator("#learning-target").click();
    await page.getByRole("option", { name: "日語", exact: true }).click();
    await page.getByRole("button", { name: "影片", exact: true }).click();
    await page.locator('[data-ui="subtitleState"][data-state="error"]').waitFor();
    assert.equal(
      await page.getByRole("button", { name: "下一步", exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await page.locator("#learning-target").isVisible(),
      true,
      "missing subtitles must leave the learning language editable on step one",
    );
    await page.locator("#learning-target").click();
    await page.getByRole("option", { name: "英語", exact: true }).click();
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    assert.equal(
      await page.getByRole("button", { name: "下一步", exact: true }).isDisabled(),
      false,
    );
    assert.match(await page.locator('[data-ui="subtitleState"]').innerText(), /英語.*60 段/);
    assert.deepEqual(
      await page.evaluate(() => window.captionRequests),
      ["ja"],
      "returning to cached subtitles must recover even when caption retrieval is unavailable",
    );
    await page.locator('section[aria-label="分析範圍"]').waitFor();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log("PASS subtitle language failure and recovery", width);
  }
} finally {
  await browser?.close();
  await server.close();
}
