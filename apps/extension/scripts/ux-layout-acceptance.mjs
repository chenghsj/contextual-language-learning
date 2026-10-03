import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-ux-layout-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const [width, height] of [
    [320, 560],
    [417, 560],
    [640, 560],
    [900, 560],
    [320, 320],
    [900, 320],
  ])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height } });
      if (height === 320) await page.emulateMedia({ reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => dialog.accept());
      await page.goto("http://127.0.0.1:5178/dev/redesign-preview.html?theme=" + theme);
      const wizard = page.locator("#page-panel-create");
      assert.equal(await wizard.locator("nav button").count(), 3);
      assert.equal(await wizard.locator("nav button").nth(1).isDisabled(), true);
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      const range = page.locator('section[aria-label="分析範圍"]');
      assert.equal(await range.getByRole("slider").count(), 0);
      await range.getByRole("combobox").click();
      await page.getByRole("option", { name: "自訂", exact: true }).click();
      assert.equal(await range.getByRole("slider").count(), 2);
      await range.getByRole("textbox", { name: "開始", exact: true }).fill("00:00:40");
      assert.equal(
        await page.getByRole("button", { name: "下一步", exact: true }).isDisabled(),
        true,
      );
      await range.getByRole("textbox", { name: "開始", exact: true }).fill("00:00:05");
      await range.getByRole("textbox", { name: "結束", exact: true }).fill("00:00:15");
      await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
      const editor = page.locator("[data-ui=subtitle-editor]");
      await editor.waitFor();
      assert.equal(await wizard.locator("footer").isVisible(), false);
      assert.ok((await editor.locator("ol li").count()) < 60);
      await editor.getByRole("button", { name: "修改", exact: true }).first().click();
      await page
        .getByRole("textbox", { name: "字幕文字", exact: true })
        .fill("Edited caption retained on reopen.");
      await page.getByRole("dialog").getByRole("button", { name: "完成", exact: true }).click();
      await editor.getByRole("textbox", { name: "搜尋字幕", exact: true }).fill("Edited caption");
      assert.equal(await editor.locator("ol li").count(), 1);
      await editor.getByRole("button", { name: "← 影片", exact: true }).click();
      await page.getByRole("button", { name: "重新取得", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "保留既有編輯", exact: true })
        .click();
      await page.waitForTimeout(350);
      await page.reload();
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
      assert.match(await editor.innerText(), /Edited caption retained on reopen/);
      await editor.getByRole("button", { name: "← 影片", exact: true }).click();
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Prompt", exact: true })
        .fill("Test retained prompt.");
      await page.getByRole("tab", { name: "標準教材", exact: true }).click();
      await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(),
        "Test retained prompt.",
      );
      await page.getByRole("button", { name: "範本管理", exact: true }).click();
      await page.getByRole("textbox", { name: "名稱", exact: true }).fill("UX template");
      await page.getByRole("button", { name: "儲存為新範本", exact: true }).click();
      await page.getByRole("textbox", { name: "名稱", exact: true }).fill("Renamed UX template");
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "已儲存" }).waitFor();
      await page.waitForTimeout(350);
      await page.reload();
      await page.waitForFunction(
        () => document.querySelector('[aria-current="step"]')?.textContent === "設定",
      );
      assert.equal(
        await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(),
        "Test retained prompt.",
      );
      await page.getByRole("combobox", { name: "範本", exact: true }).click();
      await page.getByRole("option", { name: "Renamed UX template", exact: true }).click();
      await page.getByRole("button", { name: "範本管理", exact: true }).click();
      await page.getByRole("button", { name: "刪除", exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(),
        "Test retained prompt.",
      );
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await wizard.locator("[data-ui=create-scroll]").evaluate(el => (el.scrollTop = 123));
      const scroll = await wizard.locator("[data-ui=create-scroll]").evaluate(el => el.scrollTop);
      const footer = await wizard.locator("footer").boundingBox();
      const scrollArea = await wizard.locator("[data-ui=create-scroll]").boundingBox();
      assert.ok(
        footer && footer.y >= 0 && footer.y + footer.height <= height + 1,
        "fixed footer must remain within the viewport",
      );
      assert.ok(scrollArea && scrollArea.height > 0, "form must retain an independent scroll area");
      await page.locator("#header-settings").click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      assert.equal(Math.round((await sheet.boundingBox()).width), Math.min(width, 640));
      await sheet.getByRole("button", { name: /^AI 與模型/ }).click();
      await sheet.getByRole("button", { name: /OpenAI/ }).click();
      const row = sheet
        .locator("[data-ui=piSettings] section")
        .filter({ hasText: "OpenAI" })
        .first();
      assert.match(await row.innerText(), /一組授權/);
      await page.keyboard.press("Escape");
      assert.equal(
        await wizard.locator("[data-ui=create-scroll]").evaluate(el => el.scrollTop),
        scroll,
      );
      await page.waitForFunction(() => document.activeElement?.id === "header-settings");
      assert.equal(
        await page.locator("#header-settings").evaluate(el => el === document.activeElement),
        true,
      );
      assert.equal(await wizard.locator("[aria-current=step]").innerText(), "建立");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({ path: join(output, `confirm-${width}-${height}-${theme}.png`) });
      await page.locator("#header-activity").click();
      await sheet.waitFor();
      await sheet.getByRole("button", { name: "關閉", exact: true }).click();
      assert.equal(await wizard.locator("[aria-current=step]").innerText(), "建立");
      assert.deepEqual(errors, []);
      await page.close();
      console.log("PASS layout", width, height, theme);
    }
  console.log("Evidence:", output);
} finally {
  await browser?.close();
  await server.close();
}
