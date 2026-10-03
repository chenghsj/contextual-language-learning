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
  for (const width of [320, 417, 640, 900])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 560 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://127.0.0.1:5178/dev/redesign-preview.html?theme=" + theme);
      const wizard = page.locator("#page-panel-create");
      assert.equal(await wizard.locator("nav button").count(), 3);
      assert.equal(await wizard.locator("nav button").nth(1).isDisabled(), true);
      await page.getByRole("button", { name: "取得字幕", exact: true }).click();
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
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await wizard.locator("[data-ui=create-scroll]").evaluate(el => (el.scrollTop = 123));
      const scroll = await wizard.locator("[data-ui=create-scroll]").evaluate(el => el.scrollTop);
      const footer = await wizard.locator("footer").boundingBox();
      assert.ok(footer.y + footer.height <= 561);
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
      await page.screenshot({ path: join(output, `confirm-${width}-${theme}.png`) });
      await page.locator("#header-activity").click();
      await sheet.waitFor();
      await sheet.getByRole("button", { name: "關閉", exact: true }).click();
      assert.equal(await wizard.locator("[aria-current=step]").innerText(), "建立");
      assert.deepEqual(errors, []);
      await page.close();
      console.log("PASS layout", width, theme);
    }
  console.log("Evidence:", output);
} finally {
  await browser?.close();
  await server.close();
}
