import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(
  new URL("../../../.audit/custom-favorites/screenshots/", import.meta.url),
);
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const width of [320, 480, 548])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 850 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(
        server.resolvedUrls.local[0] +
          `dev/redesign-preview.html?favorites=1&customFavorites=1&theme=${theme}`,
      );
      await page.locator("#page-nav-lessons").click();
      await page
        .locator("article")
        .filter({ hasText: "自訂教材收藏測試" })
        .getByRole("button")
        .click();
      const reader = page.locator('[data-ui="customReader"]');
      await reader.getByRole("heading", { name: "自訂教材收藏測試", exact: true }).waitFor();
      await page.getByRole("button", { name: "收藏此教材", exact: true }).click();
      const remove = page.getByRole("button", { name: "取消收藏此教材", exact: true });
      await remove.waitFor();
      assert.equal(await remove.getAttribute("aria-pressed"), "true");
      await remove.click();
      const confirmation = page.getByRole("dialog", { name: "取消收藏？", exact: true });
      await confirmation.getByRole("button", { name: "保留", exact: true }).click();
      assert.equal(await remove.getAttribute("aria-pressed"), "true");
      await page.evaluate(() => window.acceptance.deleteCustomSource());
      await reader.locator('[data-ui="reader-header"] button').first().click();
      await page.getByRole("tab", { name: "收藏", exact: true }).click();
      const card = page.locator("li").filter({ hasText: "自訂教材收藏測試" });
      await card.getByText("Synthetic custom source · 自訂內容", { exact: true }).waitFor();
      await page.getByRole("searchbox", { name: "搜尋收藏", exact: true }).fill("完整的自訂教材");
      await card.waitFor();
      await page.getByRole("searchbox", { name: "搜尋收藏", exact: true }).fill("");
      await page.getByRole("combobox", { name: "語言", exact: true }).click();
      await page.getByRole("option", { name: "未指定語言", exact: true }).click();
      await card.waitFor();
      await page.getByRole("switch", { name: "Google Drive 同步", exact: true }).click();
      await page.waitForFunction(() =>
        window.acceptance.commands.some(c => c.type === "configureFavorites"),
      );
      await card.waitFor();
      const readsBefore = await page.evaluate(
        () => window.acceptance.commands.filter(c => c.type === "getCustomDocument").length,
      );
      await card.getByRole("button").first().click();
      await reader.getByRole("button", { name: "返回收藏", exact: true }).waitFor();
      await reader.getByText("完整的自訂教材內容。", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () => window.acceptance.commands.filter(c => c.type === "getCustomDocument").length,
        ),
        readsBefore,
        "favorite opens its frozen snapshot without loading the deleted custom source",
      );
      await page.locator("#custom-reader-options").click();
      await page.getByRole("button", { name: "匯出 Markdown", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "本機刪除", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "改名", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "重新生成", exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(
        await page
          .locator('[data-ui="reader-header"]')
          .evaluateAll(elements =>
            elements.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.dataset.ui),
          ),
        [],
      );
      await page.screenshot({
        path: join(output, `custom-favorite-${width}-${theme}.png`),
        animations: "disabled",
      });
      await remove.click();
      await confirmation.getByRole("button", { name: "取消收藏", exact: true }).click();
      await page.getByRole("button", { name: "收藏此教材", exact: true }).waitFor();
      await page.getByRole("button", { name: "返回收藏", exact: true }).click();
      await page.getByText("沒有符合篩選條件的收藏。", { exact: true }).waitFor();
      await page.getByRole("combobox", { name: "語言", exact: true }).click();
      await page.getByRole("option", { name: "所有語言", exact: true }).click();
      await page.getByText("還沒有收藏。", { exact: false }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`PASS custom favorites ${width}px ${theme}`);
      await page.close();
    }
  console.log(`Evidence: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
