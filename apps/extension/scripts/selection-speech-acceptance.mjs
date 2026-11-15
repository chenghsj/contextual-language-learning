import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("..", import.meta.url));
// Actual standard reader and shared selection popup; simulated Host and video.
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const [width, theme] of [
    [480, "light"],
    [320, "dark"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/dev/redesign-preview.tsx", async route => {
      const response = await route.fetch();
      let body = await response.text();
      body = body.replace(
        '  agent: { provider: "openai", modelId: "fixture-model" },',
        '  speech: {rate:1,voices:{en:"chosen-en",ja:"chosen-ja"}},\n  agent: { provider: "openai", modelId: "fixture-model" },',
      );
      body = body.replace(
        '      default:\n        reply({ type: "error"',
        '      case "listSpeechVoices": reply({type:"speechVoices",supported:true,voices:[{id:"first-en",name:"First",language:"en-US",quality:"enhanced"},{id:"chosen-en",name:"Chosen",language:"en-US",quality:"enhanced"},{id:"chosen-ja",name:"Japanese",language:"ja-JP",quality:"enhanced"}]});break;\n      case "speak": reply({type:"speechFinished",status:"completed"});break;\n      case "stopSpeech": reply({type:"speechStopped"});break;\n      default:\n        reply({ type: "error"',
      );
      await route.fulfill({ response, body });
    });
    await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?theme=" + theme);
    await page.locator("#page-nav-lessons").click();
    await page
      .locator("article")
      .filter({ hasText: "An original video" })
      .getByRole("button")
      .click();
    const reader = page.locator('[data-ui="unifiedReader"]');
    await reader.waitFor();
    await page.evaluate(() => {
      window.selectionBridge = [];
      const send = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (...args) => {
        window.selectionBridge.push(args[1].type);
        const result = await send(...args);
        if (args[1].type === "PLAYBACK_STATUS_GET") return { ...result, playing: true };
        return result;
      };
    });
    const source = reader.locator('[data-ui="sentence-text"] [lang]').first();
    await source.scrollIntoViewIfNeeded();
    await page.evaluate(
      () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    for (const action of ["text", "control"]) {
      await source.evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      const popup = page.locator('[data-ui="selection-speech-popup"]');
      await popup.waitFor();
      assert.equal(await popup.getByRole("combobox").textContent(), "英語");
      const rect = await popup.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      const content = await reader.locator('[data-ui="lessonContent"]').boundingBox();
      assert.ok(rect.y >= content.y && rect.y + rect.height <= content.y + content.height);

      await popup.evaluate(el =>
        Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))),
      );
      const origin = await popup.boundingBox();
      await page.evaluate(() => {
        window.popupFrames = [];
        window.samplePopup = true;
        const tick = () => {
          const el = document.querySelector('[data-ui="selection-speech-popup"]');
          if (el) {
            const box = el.getBoundingClientRect();
            window.popupFrames.push({
              state: el.dataset.state,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            });
          }
          if (window.samplePopup) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      if (action === "text")
        await reader.locator('[data-ui="sentence-text"] [lang]').nth(1).click();
      else await reader.locator('[data-ui="analysis-toggle-all"]').click();
      await page.waitForTimeout(300);
      await page.evaluate(() => (window.samplePopup = false));
      const frames = await page.evaluate(() => window.popupFrames);
      const moved = frames.filter(
        box => Math.abs(box.y - origin.y) > 12 || Math.abs(box.x - origin.x) > 12,
      );
      assert.deepEqual(moved, [], "dismissed popup must not reappear or move to the outside click");
      let closed = false;
      for (const frame of frames) {
        if (frame.state === "closed") closed = true;
        if (closed)
          assert.equal(frame.state, "closed", "dismissed popup cannot reopen while closing");
      }
      assert.equal(await popup.count(), 0);
      console.log(
        "PASS " + action + " outside click does not move/reopen popup " + width + " " + theme,
      );
    }
    await page.close();
  }
  for (const width of [480, 320]) {
    for (const mode of ["unsupported", "unsupported-unknown-language", "missing", "unavailable"]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        window.speechLists = 0;
      });
      await page.route("**/dev/redesign-preview.tsx", async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace(
          '      default:\n        reply({ type: "error"',
          `      case "listSpeechVoices":
            if (${JSON.stringify(mode)} === "unavailable" && ++window.speechLists === 1)
              reply({type:"error",message:"Simulated unavailable service"});
            else reply({type:"speechVoices",supported:${!mode.startsWith("unsupported")},voices:${mode.startsWith("unsupported") ? "[]" : mode === "missing" ? '[{id:"ja",name:"Japanese",language:"ja-JP",quality:"enhanced"}]' : '[{id:"en",name:"English",language:"en-US",quality:"enhanced"}]'}});
            break;
          case "stopSpeech": reply({type:"speechStopped"});break;
          default:
        reply({ type: "error"`,
        );
        await route.fulfill({ response, body });
      });
      await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html");
      await page.locator("#page-nav-lessons").click();
      await page
        .locator("article")
        .filter({ hasText: "An original video" })
        .getByRole("button")
        .click();
      const source = page.locator('[data-ui="sentence-text"] [lang]').first();
      await source.scrollIntoViewIfNeeded();
      await source.evaluate((el, mode) => {
        if (mode === "unsupported-unknown-language") {
          el.textContent = "12345";
          el.removeAttribute("lang");
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      }, mode);
      const popup = page.locator('[data-ui="selection-speech-popup"]');
      await popup.waitFor();
      const play = popup.getByRole("button", { name: "朗讀選取原文", exact: true });
      if (mode.startsWith("unsupported")) {
        await popup.getByText("此電腦的系統版本或平台不支援系統朗讀。", { exact: true }).waitFor();
        assert.equal(await popup.getByRole("combobox").count(), 0);
        assert.equal(await popup.getByRole("button").count(), 0);
      } else {
        await popup.getByRole("combobox").waitFor();
        if (mode === "missing") {
          await popup.getByText("此語言目前沒有可用的高品質系統語音。", { exact: true }).waitFor();
          assert.equal(await play.count(), 0);
          await popup.getByRole("combobox").click();
          await page.getByRole("option", { name: "日語", exact: true }).click();
        } else {
          await popup
            .getByText("請連接本機服務以使用系統朗讀；若已連線，請確認系統語音後重試。", {
              exact: true,
            })
            .waitFor();
          assert.equal(await play.count(), 0);
          await popup.getByRole("button", { name: "重新連線", exact: true }).click();
        }
        await play.waitFor();
        assert.equal(await play.isEnabled(), true);
      }
      await popup.evaluate(el =>
        Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))),
      );
      const rect = await popup.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width, "status popup fits the viewport");
      const text = await source.boundingBox();
      assert.ok(
        rect.y + rect.height <= text.y || rect.y >= text.y + text.height,
        "status does not cover selected text",
      );
      assert.deepEqual(errors, []);
      if (width === 320 && mode === "unsupported")
        await page.screenshot({ path: "/tmp/selection-unsupported-320.png" });
      console.log("PASS speech availability " + mode + " " + width);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
