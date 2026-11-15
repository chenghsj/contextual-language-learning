// Actual App/components; browser video/Host responses use the development fixture.
import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-subtitle-editor-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5186, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480, 900])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      page.setDefaultTimeout(10000);
      const errors = [],
        nativeDialogs = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", async dialog => {
        nativeDialogs.push(dialog.type());
        await dialog.dismiss();
      });
      await page.goto(
        `http://127.0.0.1:5186/dev/redesign-preview.html?theme=${theme}&captions=early-ending`,
      );
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      await page.evaluate(() => {
        const original = chrome.tabs.sendMessage;
        window.seekRequests = [];
        window.subtitlePlaybackRequests = [];
        window.subtitleVideoState = null;
        chrome.tabs.sendMessage = async (id, message) => {
          if (message.type === "YOUTUBE_SEEK") window.seekRequests.push(message.timeMs);
          if (["LOOP_SET", "LOOP_CLEAR", "PLAYBACK_PAUSE"].includes(message.type))
            window.subtitlePlaybackRequests.push(message);
          if (message.type === "LOOP_SET")
            window.subtitleVideoState = { currentMs: message.startMs, playing: true };
          if (message.type === "PLAYBACK_PAUSE" && window.subtitleVideoState)
            window.subtitleVideoState.playing = false;
          if (message.type === "PLAYBACK_STATUS_GET" && window.subtitleVideoState)
            return { ok: true, durationMs: 30000, ...window.subtitleVideoState };
          return original(id, message);
        };
      });
      const range = page.locator('section[aria-label="分析範圍"]');
      await range.getByRole("combobox").click();
      await page.getByRole("option", { name: "自訂", exact: true }).click();
      const start = range.getByRole("textbox", { name: "開始", exact: true });
      const end = range.getByRole("textbox", { name: "結束", exact: true });
      await start.fill("00:02.669");
      await end.fill("00:29.004");
      await range.getByRole("heading").click();
      assert.equal(await start.inputValue(), "00:02.7");
      assert.equal(await end.inputValue(), "00:29.0");
      await start.focus();
      await end.focus();
      await range.getByRole("heading").click();
      await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
      const editor = page.locator("[data-ui=subtitle-editor]");
      const firstRow = editor.locator("li").first();
      const search = editor.getByRole("textbox", { name: "搜尋字幕", exact: true });
      assert.equal(await editor.getByRole("heading").count(), 0);
      assert.equal(await page.locator('[data-ui="create-steps"]').isVisible(), false);
      assert.match(await editor.innerText(), /3 \/ 3/);
      assert.equal(
        await editor.getByRole("button", { name: "還原原始字幕", exact: true }).count(),
        0,
      );
      assert.equal(await firstRow.getByRole("button", { name: "展開全文" }).count(), 0);
      await firstRow.getByRole("button", { name: "修改", exact: true }).click();
      const longText =
        "僕のマはふわふわ。這是一段需要完整閱讀的長字幕，包含不同語言與完整句子。 ".repeat(24) +
        "\nEnd of full subtitle.";
      await page
        .getByRole("dialog")
        .getByRole("textbox", { name: "字幕文字", exact: true })
        .fill(longText);
      await page.getByRole("dialog").getByRole("button", { name: "完成", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      const fullTextTrigger = firstRow.getByRole("button", { name: "展開全文", exact: true });
      await fullTextTrigger.waitFor();
      const rowBox = await firstRow.boundingBox();
      const expandBox = await fullTextTrigger.boundingBox();
      assert.equal(rowBox.height, 108, "fixed row height is preserved");
      assert.ok(
        expandBox.y + expandBox.height <= rowBox.y + rowBox.height,
        "full text action is not clipped",
      );
      assert.deepEqual(
        await firstRow.locator("p").evaluate(el => ({
          fontSize: getComputedStyle(el).fontSize,
          lineHeight: getComputedStyle(el).lineHeight,
        })),
        { fontSize: "14px", lineHeight: "21px" },
      );
      await editor.screenshot({ path: join(output, `preview-${width}-${theme}.png`) });
      await fullTextTrigger.click();
      const fullText = page.getByRole("dialog", { name: "字幕文字", exact: true });
      const reader = fullText.locator("[tabindex='0']");
      assert.equal(await reader.innerText(), longText);
      assert.equal(
        await fullText.getByRole("textbox").count(),
        0,
        "full text is readable without editing",
      );
      assert.equal(await fullText.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      assert.equal(
        await reader.evaluate(el => el.scrollHeight > el.clientHeight),
        true,
        "long text can scroll",
      );
      await reader.evaluate(el => {
        el.scrollTop = el.scrollHeight;
      });
      await fullText.screenshot({ path: join(output, `full-text-${width}-${theme}.png`) });
      await page.keyboard.press("Escape");
      await fullText.waitFor({ state: "detached" });
      assert.equal(await fullTextTrigger.evaluate(el => el === document.activeElement), true);
      await search.fill("End of full subtitle");
      assert.match(await editor.innerText(), /1 \/ 3/);
      await search.fill("does-not-exist");
      assert.match(await editor.innerText(), /0 \/ 3/);
      await search.fill("");
      assert.match(await editor.innerText(), /3 \/ 3/);
      assert.equal(
        await editor.getByRole("button", { name: "00:08.0 → 00:19.0", exact: true }).count(),
        1,
      );
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      const edit = page.getByRole("dialog");
      assert.equal(
        await edit.getByRole("textbox", { name: "開始", exact: true }).inputValue(),
        "00:08.0",
      );
      assert.equal(
        await edit.getByRole("textbox", { name: "結束", exact: true }).inputValue(),
        "00:19.0",
      );
      assert.equal(
        await edit.getByRole("button", { name: "重設時間", exact: true }).isDisabled(),
        true,
      );
      await edit.getByRole("button", { name: "試聽這段", exact: true }).click();
      await page.waitForFunction(() =>
        window.subtitlePlaybackRequests.some(
          message =>
            message.type === "LOOP_SET" && message.startMs === 8040 && message.endMs === 19000,
        ),
      );
      await edit.getByRole("button", { name: "停止試聽", exact: true }).click();
      await edit
        .getByRole("textbox", { name: "字幕文字", exact: true })
        .fill("Text-only edit preserved.");
      await edit.getByRole("textbox", { name: "開始", exact: true }).focus();
      await edit.getByRole("textbox", { name: "結束", exact: true }).focus();
      await edit.getByRole("button", { name: "完成", exact: true }).click();
      await edit.waitFor({ state: "detached" });
      assert.equal(
        await editor.getByRole("button", { name: "00:08.0 → 00:19.0", exact: true }).count(),
        1,
      );
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      assert.equal(
        await edit.getByRole("button", { name: "重設時間", exact: true }).isDisabled(),
        true,
        "text-only edit cannot become manual timing",
      );
      await edit
        .getByRole("textbox", { name: "字幕文字", exact: true })
        .fill("Precision caption retained.");
      await edit.getByRole("textbox", { name: "開始", exact: true }).fill("00:00:02.669");
      await edit.getByRole("textbox", { name: "結束", exact: true }).fill("00:00:04.921");
      await edit.getByRole("textbox", { name: "字幕文字", exact: true }).focus();
      assert.match(await editor.locator("li").first().innerText(), /Text-only edit preserved/);
      await edit.getByRole("button", { name: "完成", exact: true }).click();
      const time = editor.getByRole("button", { name: "00:02.7 → 00:04.9", exact: true });
      await time.hover();
      const padding = await time.evaluate(el => ({
        left: getComputedStyle(el).paddingLeft,
        right: getComputedStyle(el).paddingRight,
      }));
      assert.deepEqual(padding, { left: "8px", right: "8px" });
      await time.click();
      await page.waitForFunction(() => window.seekRequests.includes(2669));
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      await edit.getByRole("button", { name: "重設時間", exact: true }).click();
      assert.equal(
        await edit.getByRole("textbox", { name: "開始", exact: true }).inputValue(),
        "00:08.0",
      );
      assert.equal(
        await edit.getByRole("textbox", { name: "結束", exact: true }).inputValue(),
        "00:19.0",
      );
      await edit.getByRole("button", { name: "取消", exact: true }).click();
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      assert.equal(
        await edit.getByRole("textbox", { name: "開始", exact: true }).inputValue(),
        "00:02.7",
      );
      assert.equal(
        await edit.getByRole("textbox", { name: "結束", exact: true }).inputValue(),
        "00:04.9",
      );
      // Merely focusing/formatting fields and editing text must retain milliseconds.
      await edit.getByRole("textbox", { name: "開始", exact: true }).focus();
      await edit.getByRole("textbox", { name: "結束", exact: true }).focus();
      await edit.getByRole("button", { name: "完成", exact: true }).click();
      await page.evaluate(() => {
        window.seekRequests = [];
      });
      await time.click();
      await page.waitForFunction(() => window.seekRequests.includes(2669));
      for (const closeMethod of ["取消", "關閉", "Escape"]) {
        await editor.getByRole("button", { name: "修改", exact: true }).first().click();
        await edit
          .getByRole("textbox", { name: "字幕文字", exact: true })
          .fill("Discard this change.");
        await edit.getByRole("textbox", { name: "開始", exact: true }).fill("bad time");
        if (closeMethod === "Escape") await page.keyboard.press("Escape");
        else await edit.getByRole("button", { name: closeMethod, exact: true }).click();
        await edit.waitFor({ state: "detached" });
        assert.match(await editor.locator("li").first().innerText(), /Precision caption retained/);
      }
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      const startInput = edit.getByRole("textbox", { name: "開始", exact: true });
      const endInput = edit.getByRole("textbox", { name: "結束", exact: true });
      await edit.getByRole("button", { name: "開始 +0.1s", exact: true }).click();
      await edit.getByRole("button", { name: "試聽這段", exact: true }).click();
      await page.waitForFunction(() =>
        window.subtitlePlaybackRequests.some(
          message =>
            message.type === "LOOP_SET" &&
            message.startMs === 2769 &&
            message.endMs === 4921 &&
            message.repeats === 1,
        ),
      );
      await edit.getByRole("button", { name: "停止試聽", exact: true }).click();
      await startInput.press("ArrowDown");
      await startInput.press("Shift+ArrowUp");
      await startInput.press("Shift+ArrowDown");
      await page.evaluate(() => {
        window.subtitleVideoState = { currentMs: 2357, playing: true };
      });
      await edit
        .getByRole("group", { name: "開始", exact: true })
        .getByRole("button", { name: "設為影片目前位置" })
        .click();
      assert.equal(await startInput.inputValue(), "00:02.4");
      await page.evaluate(() => {
        window.subtitleVideoState = { currentMs: 5123, playing: true };
      });
      await edit
        .getByRole("group", { name: "結束", exact: true })
        .getByRole("button", { name: "設為影片目前位置" })
        .click();
      assert.equal(await endInput.inputValue(), "00:05.1");
      await edit.getByRole("button", { name: "試聽這段", exact: true }).click();
      await page.waitForFunction(() =>
        window.subtitlePlaybackRequests.some(
          message =>
            message.type === "LOOP_SET" && message.startMs === 2357 && message.endMs === 5123,
        ),
      );
      assert.equal(await edit.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await edit.screenshot({ path: join(output, `edit-${width}-${theme}.png`) });
      const stopsBefore = await page.evaluate(
        () =>
          window.subtitlePlaybackRequests.filter(message => message.type === "LOOP_CLEAR").length,
      );
      await edit.getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForFunction(
        count =>
          window.subtitlePlaybackRequests.filter(message => message.type === "LOOP_CLEAR").length >
          count,
        stopsBefore,
      );
      // Cancel leaves the saved text and source precision intact.
      await page.evaluate(() => {
        window.seekRequests = [];
      });
      await time.click();
      await page.waitForFunction(() => window.seekRequests.includes(2669));
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      await edit.getByRole("textbox", { name: "字幕文字", exact: true }).fill("");
      await edit.getByRole("button", { name: "完成", exact: true }).click();
      assert.equal(await edit.getByRole("alert").count(), 1);
      await edit.getByRole("button", { name: "取消", exact: true }).click();
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      await edit.getByRole("button", { name: "重設時間", exact: true }).click();
      await edit.getByRole("button", { name: "完成", exact: true }).click();
      await edit.waitFor({ state: "detached" });
      assert.equal(
        await editor.getByRole("button", { name: "00:08.0 → 00:19.0", exact: true }).count(),
        1,
      );
      assert.match(await editor.locator("li").first().innerText(), /Precision caption retained/);
      const actions = editor.getByRole("button", { name: "字幕操作", exact: true });
      const restore = page.getByRole("button", { name: "還原原始字幕", exact: true });
      async function openRestore() {
        await actions.click();
        await restore.click();
        await page.getByRole("alertdialog").waitFor();
      }
      const alert = page.getByRole("alertdialog");
      await openRestore();
      await alert.waitFor();
      assert.equal(
        await alert
          .getByRole("button", { name: "取消", exact: true })
          .evaluate(el => el === document.activeElement),
        true,
      );
      await alert.screenshot({ path: join(output, `restore-${width}-${theme}.png`) });
      await alert.getByRole("button", { name: "取消", exact: true }).click();
      await alert.waitFor({ state: "detached" });
      assert.match(await editor.innerText(), /Precision caption retained/);
      assert.equal(await actions.evaluate(el => el === document.activeElement), true);
      await openRestore();
      await page.keyboard.press("Escape");
      await alert.waitFor({ state: "detached" });
      assert.match(await editor.innerText(), /Precision caption retained/);
      await openRestore();
      await alert.getByRole("button", { name: "還原原始字幕", exact: true }).click();
      await alert.waitFor({ state: "detached" });
      assert.doesNotMatch(await editor.innerText(), /Precision caption retained/);
      assert.match(await editor.innerText(), /Line 1: useful dialogue/);
      await editor.getByRole("button", { name: "返回影片", exact: true }).click();
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Prompt", exact: true })
        .fill("Precision acceptance.");
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page
        .locator('[data-ui="create-footer"]')
        .getByRole("button", { name: "建立內容", exact: true })
        .click();
      await page.waitForFunction(() =>
        window.acceptance.commands.some(command => command.type === "generateCustom"),
      );
      const payload = await page.evaluate(
        () => window.acceptance.commands.find(command => command.type === "generateCustom").payload,
      );
      assert.equal(payload.analysisRange.startMs, 2669);
      assert.equal(payload.analysisRange.endMs, 29004);
      assert.deepEqual(nativeDialogs, []);
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.close();
      console.log(
        "PASS compact edit, precise draft/seek, cancel/close/Escape, nudge/capture/preview, restore and generation range",
        width,
        theme,
      );
    }
  console.log("Evidence:", output);
} finally {
  await browser?.close();
  await server.close();
}
