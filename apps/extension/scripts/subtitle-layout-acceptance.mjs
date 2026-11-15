import { chromium } from "playwright";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";

// Real App with simulated video responses. This verifies layout and recovery
// interactions, not availability of captions in an installed YouTube session.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.env.SUBTITLE_LAYOUT_OUTPUT ?? "/tmp/cll-subtitle-layout";
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 5196, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      let api;
      window.captionFixture = { hold: false, release: null, requests: [] };
      Object.defineProperty(window, "chrome", {
        configurable: true,
        get: () => api,
        set: value => {
          const original = value.tabs.sendMessage;
          value.tabs.sendMessage = async (id, message) => {
            if (message.type === "YOUTUBE_CAPTION_TRACKS_GET") {
              return {
                ok: true,
                status: "available",
                tracks: [
                  { language: "en", kind: "manual" },
                  { language: "ja", kind: "auto" },
                  { language: "id", kind: "translated" },
                ],
              };
            }
            if (message.type === "YOUTUBE_SUBTITLES_GET" && message.language !== "en") {
              window.captionFixture.requests.push(message.language);
              if (window.captionFixture.hold) {
                await new Promise(resolve => {
                  window.captionFixture.release = resolve;
                });
              }
              return { ok: false, error: "Empty subtitle response", errorCode: "CAPTION_EMPTY" };
            }
            return original(id, message);
          };
          api = value;
        },
      });
    });
    await page.goto("http://127.0.0.1:5196/dev/redesign-preview.html");
    const section = page.locator('[data-ui="subtitleState"]');
    const manual = page.locator('[data-ui="subtitleImport"]');
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    assert.match(await section.innerText(), /英語.*60 段字幕/);
    assert.equal(
      await manual
        .getByRole("button", { name: "自行匯入字幕", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    await page.locator("#learning-target").click();
    await page.getByRole("option", { name: "印尼語", exact: true }).click();
    await page.locator('[data-ui="subtitleState"][data-state="error"]').waitFor();
    assert.match(await section.innerText(), /尚未取得印尼語字幕/);
    assert.match(await section.innerText(), /自動翻譯 → 印尼語/);
    assert.ok(!(await section.innerText()).includes("可用字幕語言"));
    assert.equal(
      await section.getByRole("button", { name: "重新取得字幕", exact: true }).count(),
      1,
    );
    assert.equal(
      await manual
        .getByRole("button", { name: "自行匯入字幕", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    await page.locator("[data-radix-popper-content-wrapper]").waitFor({ state: "detached" });
    await section.scrollIntoViewIfNeeded();
    const subtitleBox = await section.boundingBox();
    const manualBox = await manual.boundingBox();
    await page.screenshot({
      path: `${output}/subtitle-error-${width}.png`,
      clip: {
        x: Math.floor(subtitleBox.x),
        y: Math.floor(subtitleBox.y),
        width: Math.ceil(subtitleBox.width),
        height: Math.ceil(manualBox.y + manualBox.height - subtitleBox.y),
      },
    });
    const buttonBox = await section.getByRole("button", { name: "重新取得字幕" }).boundingBox();
    assert.ok(Math.abs(buttonBox.width - subtitleBox.width) < 1, "one full-width primary action");
    assert.ok(buttonBox.height >= 36, "primary action retains a usable hit area");
    await page.locator("#learning-target").click();
    await page.getByRole("option", { name: "日語", exact: true }).waitFor();
    await page.getByRole("option", { name: "英語", exact: true }).waitFor();
    assert.match(
      await page.getByRole("option", { name: "日語", exact: true }).innerText(),
      /自動產生/,
    );
    assert.match(
      await page.getByRole("option", { name: "印尼語", exact: true }).innerText(),
      /自動翻譯/,
    );
    await page.locator("[data-radix-popper-content-wrapper]").evaluate(async el => {
      await Promise.all(
        el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({ path: `${output}/subtitle-options-${width}.png` });
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth > innerWidth,
      popup: Array.from(document.querySelectorAll('[role="option"]')).some(
        el => el.getBoundingClientRect().right > innerWidth || el.scrollWidth > el.clientWidth,
      ),
    }));
    assert.deepEqual(overflow, { page: false, popup: false });
    await page.keyboard.press("Escape");
    await manual.getByRole("button", { name: "自行匯入字幕" }).click();
    await manual.getByRole("tab", { name: "貼上文字" }).click();
    await manual.getByRole("textbox").fill("Preserved manual draft");
    await manual.getByRole("button", { name: "自行匯入字幕" }).click();
    await page.evaluate(() => {
      window.captionFixture.hold = true;
    });
    await section.getByRole("button", { name: "重新取得字幕", exact: true }).click();
    await page.locator('[data-ui="subtitleState"][data-state="loading"]').waitFor();
    assert.equal(
      (await section.innerText()).split("正在取得").length - 1,
      1,
      "loading message appears once",
    );
    assert.equal(
      await section.getByRole("button", { name: "取得字幕", exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await manual
        .getByRole("button", { name: "自行匯入字幕", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    );
    await section.screenshot({ path: `${output}/subtitle-loading-${width}.png` });
    await page.evaluate(() => {
      window.captionFixture.release();
    });
    await page.locator('[data-ui="subtitleState"][data-state="error"]').waitFor();
    await manual.getByRole("button", { name: "自行匯入字幕" }).click();
    await manual.getByRole("tab", { name: "貼上文字" }).click();
    assert.equal(await manual.getByRole("textbox").inputValue(), "Preserved manual draft");
    await manual.getByRole("button", { name: "自行匯入字幕" }).click();
    await page.locator("#learning-target").click();
    await page.getByRole("option", { name: "英語", exact: true }).click();
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.locator("[data-radix-popper-content-wrapper]").waitFor({ state: "detached" });
    await section.screenshot({ path: `${output}/subtitle-ready-${width}.png` });
    assert.match(await section.innerText(), /英語.*60 段字幕/);
    assert.deepEqual(await page.evaluate(() => window.captionFixture.requests), ["id", "id"]);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      "PASS compact subtitle layout, language options, retry and draft preservation",
      width,
    );
  }
  console.log("Screenshots:", output);
} finally {
  await browser?.close();
  await server.close();
}
