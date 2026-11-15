import assert from "node:assert/strict";
import { mockYouTube } from "./fake-youtube.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import { chromium } from "../../extension/node_modules/playwright/index.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../../../.audit/favorites-web/browser/", import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "localhost", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];
  for (const width of [320, 480, 1100])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [],
        externalImages = [];
      page.on("pageerror", e => {
        errors.push(e.message);
        console.log("PAGE ERROR", e.message);
      });
      page.on("request", request => {
        if (request.url().includes("remote.invalid")) externalImages.push(request.url());
      });
      const embeds = [];
      await mockYouTube(page, embeds);
      await page.goto(server.resolvedUrls.local[0] + "?demo=1");
      const cards = page.locator(".cards > li");
      await cards
        .nth(1)
        .waitFor()
        .catch(async error => {
          console.log(await page.locator("body").innerText());
          throw error;
        });
      assert.equal(
        await cards.count(),
        2,
        "all backed-up materials appear independently of favorites",
      );
      assert.equal(await page.locator('[data-slot="card"]').count(), 3);
      await page.evaluate(() => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => {
          window.installTestInvoked = true;
        };
        event.userChoice = Promise.resolve({ outcome: "dismissed" });
        window.dispatchEvent(event);
      });
      await page.getByRole("button", { name: "安裝 App", exact: true }).click();
      assert.equal(
        await page.evaluate(() => window.installTestInvoked),
        true,
        "install action calls the browser-provided prompt",
      );
      await page.getByRole("button", { name: "安裝 App", exact: true }).click();
      await page.getByText("加入主畫面", { exact: true }).waitFor();
      await page.getByText("加入主畫面", { exact: true }).press("Escape");

      const opposite = theme === "light" ? "dark" : "light";
      const themeTrigger = page.getByRole("combobox", { name: "外觀主題" });
      const themeBox = await themeTrigger.boundingBox();
      assert.equal(themeBox.width, 36, "theme control is an icon-sized button");
      assert.equal(themeBox.height, 36);
      assert.equal(
        await themeTrigger.locator("svg:visible").count(),
        1,
        "no dropdown chevron is visible",
      );
      const themeLabel = await themeTrigger.locator(".sr-only").boundingBox();
      assert.ok(themeLabel.width <= 1 && themeLabel.height <= 1, "theme label is visually hidden");
      await page.getByRole("combobox", { name: "外觀主題" }).click();
      await page
        .getByRole("option", { name: opposite === "dark" ? "深色" : "淺色", exact: true })
        .click();
      assert.equal(
        await page.locator("html").evaluate(el => el.classList.contains("dark")),
        opposite === "dark",
      );
      await page.getByRole("button", { name: "列表顯示", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "列表顯示", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.ok((await cards.first().boundingBox()).height < 220, "list rows are compact");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.reload();
      await cards.nth(1).waitFor();
      assert.equal(
        await page.locator("html").evaluate(el => el.classList.contains("dark")),
        opposite === "dark",
        "theme persists across reload",
      );
      assert.ok(
        await page.locator(".cards.list-view").isVisible(),
        "list preference persists across reload",
      );
      await page.emulateMedia({ colorScheme: theme });
      assert.equal(
        await page.locator("html").evaluate(el => el.classList.contains("dark")),
        opposite === "dark",
        "explicit theme overrides system",
      );
      await page.screenshot({
        path: join(output, `materials-list-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.getByRole("combobox", { name: "外觀主題" }).click();
      await page.getByRole("option", { name: "跟隨系統", exact: true }).click();
      await page.waitForFunction(
        expected => document.documentElement.classList.contains("dark") === expected,
        theme === "dark",
      );
      await page.emulateMedia({ colorScheme: opposite });
      await page.waitForFunction(
        expected => document.documentElement.classList.contains("dark") === expected,
        opposite === "dark",
      );
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(
        expected => document.documentElement.classList.contains("dark") === expected,
        theme === "dark",
      );
      await page.getByRole("button", { name: "卡片顯示", exact: true }).click();

      await page.getByRole("combobox", { name: "教材語言" }).click();
      await page.getByPlaceholder("搜尋語言", { exact: true }).fill("日本語");
      assert.equal(await page.getByRole("option").count(), 1);
      await page.getByPlaceholder("搜尋語言", { exact: true }).fill("no-such-language");
      await page.getByText("找不到符合的語言", { exact: true }).waitFor();
      await page.getByPlaceholder("搜尋語言", { exact: true }).fill("JAPANESE");
      assert.equal(await page.getByRole("option").count(), 1);

      await page.getByPlaceholder("搜尋語言", { exact: true }).press("ArrowDown");
      await page.getByPlaceholder("搜尋語言", { exact: true }).press("Enter");
      assert.equal(await cards.count(), 0);
      await page.getByRole("combobox", { name: "教材語言" }).click();
      await page.getByRole("option", { name: "所有語言", exact: true }).click();
      await cards.filter({ hasText: "完整情境教材" }).getByRole("button").click();
      await page.getByRole("combobox", { name: "直接選擇場景" }).waitFor();
      await page.locator('[data-ui="unifiedReader"]').waitFor();
      const video = page.locator('iframe[title^="YouTube 影片："]');
      await video.waitFor();
      await page.waitForFunction(() => !!document.querySelector("iframe")?.contentWindow);
      const videoBounds = await video.boundingBox();
      assert.ok(
        videoBounds.width >= 200 && videoBounds.height >= 200,
        "embedded player preserves YouTube minimum viewport",
      );
      assert.equal(await video.getAttribute("referrerpolicy"), "strict-origin-when-cross-origin");
      assert.ok(
        (await video.getAttribute("src")).includes("enablejsapi=1"),
        "standard scene starts at its scene timestamp",
      );
      assert.ok(embeds.length > 0);
      assert.equal(
        embeds[0].referer,
        new URL(page.url()).origin + "/",
        "only site origin is sent to YouTube for player identity",
      );

      const reader = page.locator('[data-ui="unifiedReader"]');
      const player = reader.locator('[data-ui="unifiedPlayer"]');
      await page.waitForFunction(() => !!window.syntheticPlayer);
      assert.equal(
        await reader.getByRole("button", { name: "播放選項", exact: true }).count(),
        0,
        "website omits timing editing controls",
      );
      await reader.getByRole("button", { name: "顯示翻譯", exact: true }).click();
      await reader.getByText("晚餐怎麼辦？", { exact: true }).waitFor();
      await reader.getByRole("button", { name: "隱藏翻譯", exact: true }).click();
      await reader.locator('[data-ui="analysis-toggle"]').nth(1).click();
      await reader.locator('[data-ui="inlineAnalysis"]').nth(1).waitFor();
      await reader.getByRole("button", { name: "發音標註", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await player.getByRole("combobox", { name: "速度", exact: true }).click();
      await page.getByRole("option", { name: "1.5×", exact: true }).click();
      await page.waitForFunction(() =>
        window.youtubeCalls.some(([action, value]) => action === "rate" && value === 1.5),
      );
      await player.getByRole("button", { name: "循環", exact: true }).click();
      await player.getByRole("button", { name: "播放", exact: true }).click();
      await player.getByRole("button", { name: "暫停", exact: true }).waitFor();
      const beforeLoop = await page.evaluate(
        () => window.youtubeCalls.filter(([action]) => action === "seek").length,
      );
      await page.evaluate(() => {
        window.syntheticPlayer.time = 8;
      });
      await page.waitForFunction(
        count => window.youtubeCalls.filter(([action]) => action === "seek").length > count,
        beforeLoop,
      );
      await player.getByRole("button", { name: "暫停", exact: true }).click();
      await player.getByRole("button", { name: "播放", exact: true }).waitFor();
      await reader.locator('[data-ui="cue-play"]').first().click();
      await page.waitForFunction(() =>
        window.youtubeCalls.some(([action, time]) => action === "seek" && time === 1),
      );
      await player.getByRole("button", { name: "下一句", exact: true }).click();
      await page.waitForFunction(() =>
        window.youtubeCalls.some(([action, time]) => action === "seek" && time === 3.1),
      );
      await player.getByRole("button", { name: "暫停", exact: true }).click();
      const remove = reader.getByRole("button", { name: "取消收藏此情境", exact: true });
      await remove.click();
      await page.getByRole("dialog").getByRole("button", { name: "保留", exact: true }).click();
      assert.equal(await remove.getAttribute("aria-pressed"), "true");
      await remove.click();
      await page.getByRole("dialog").getByRole("button", { name: "取消收藏", exact: true }).click();
      await reader.getByRole("button", { name: "收藏此情境", exact: true }).waitFor();
      await reader.getByRole("button", { name: "收藏此情境", exact: true }).click();
      await remove.waitFor();
      assert.equal(await remove.getAttribute("aria-pressed"), "true");
      await page.screenshot({
        path: join(output, `material-reader-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "返回內容庫" }).click();
      await cards.filter({ hasText: "雲端自訂筆記" }).getByRole("button").click();
      await page.getByRole("article", { name: "教材內容" }).waitFor();
      await page.getByRole("button", { name: "收藏此情境", exact: true }).click();
      await page.getByRole("button", { name: "取消收藏此情境", exact: true }).waitFor();
      await page.getByRole("button", { name: "取消收藏此情境", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "取消收藏", exact: true }).click();
      await page.getByRole("button", { name: "收藏此情境", exact: true }).waitFor();
      await page.getByRole("button", { name: "返回內容庫" }).click();
      assert.equal(await cards.filter({ hasText: "舊版教材備份" }).count(), 0);
      await page.screenshot({
        path: join(output, `materials-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.getByRole("tab", { name: "收藏", exact: true }).click();
      await cards.nth(1).waitFor();
      assert.equal(await cards.count(), 2);
      await page.getByRole("combobox", { name: "教材語言" }).click();
      await page.getByPlaceholder("搜尋語言", { exact: true }).fill("en");
      await page.getByRole("option", { name: "英語", exact: true }).waitFor();
      await page.getByPlaceholder("搜尋語言", { exact: true }).fill("all");
      await page.getByRole("option", { name: "所有語言", exact: true }).click();

      await page.getByRole("button", { name: "列表顯示", exact: true }).click();
      assert.ok(
        await page.locator(".cards.list-view").isVisible(),
        "favorites support the same list layout",
      );
      await page.getByRole("tab", { name: "所有教材", exact: true }).click();
      await cards.nth(1).waitFor();
      assert.ok(await page.locator(".cards.list-view").isVisible(), "layout is shared across tabs");
      await page.getByRole("tab", { name: "收藏", exact: true }).click();
      await cards.nth(1).waitFor();
      await page.screenshot({
        path: join(output, `favorites-list-${width}-${theme}.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "卡片顯示", exact: true }).click();

      assert.equal(
        await page.evaluate(() => typeof chrome !== "undefined" && !!chrome.runtime),
        false,
        "website runs without extension APIs",
      );
      await page.getByRole("searchbox", { name: "搜尋收藏" }).fill("自訂學習筆記");
      assert.equal(await cards.count(), 1);
      await page.getByRole("searchbox").fill("");
      await cards.filter({ hasText: "日常會話的留白" }).getByRole("button").click();
      await page.getByRole("heading", { name: "日常會話的留白", exact: true }).last().waitFor();
      await page.getByText("還沒有決定，也可以是對話的開始。", { exact: true }).waitFor();
      await page.getByRole("button", { name: "取消收藏此情境", exact: true }).waitFor();
      assert.equal(await page.locator("main img").count(), 0);
      assert.deepEqual(externalImages, []);
      await page.screenshot({ path: join(output, `reader-${width}-${theme}.png`), fullPage: true });
      await page.getByRole("button", { name: "返回收藏" }).click();
      await context.setOffline(true);
      const readsBefore = await page.evaluate(() => window.webAcceptance.reads.length);
      await cards.filter({ hasText: "日常會話的留白" }).getByRole("button").click();
      await page.getByText("還沒有決定，也可以是對話的開始。", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.webAcceptance.reads.length),
        readsBefore,
        "cached content reads offline",
      );
      await page.getByRole("button", { name: "返回收藏" }).click();
      await cards.filter({ hasText: "An original video" }).getByRole("button").click();
      await page.getByRole("alert").filter({ hasText: "需要連線" }).waitFor();
      await context.setOffline(false);
      await cards.filter({ hasText: "An original video" }).getByRole("button").click();
      await page.locator('[data-ui="unifiedReader"]').waitFor();
      await page.getByRole("button", { name: "返回收藏" }).click();
      await page.evaluate(() => window.webAcceptance.setFailure(true));
      await page.getByRole("button", { name: "重新整理收藏" }).click();
      await page.getByRole("alert").filter({ hasText: "Synthetic connection failure" }).waitFor();
      assert.equal(await cards.count(), 2, "partial catalogs preserve the last complete list");
      await page.evaluate(() => {
        window.webAcceptance.setFailure(false);
        window.webAcceptance.removeCustom();
      });
      await page.getByRole("button", { name: "重新整理收藏" }).click();
      await cards.filter({ hasText: "日常會話的留白" }).waitFor({ state: "hidden" });
      assert.equal(await cards.count(), 1, "desktop cancellation is reflected on the website");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: join(output, `library-${width}-${theme}.png`),
        fullPage: true,
      });
      const second = await context.newPage();
      await second.goto(server.resolvedUrls.local[0]);
      await second.locator(".cards > li").first().waitFor();
      await page.getByRole("button", { name: "登出並清除本機副本" }).click();
      await second.getByText("連結你的 Google Drive", { exact: true }).waitFor();
      assert.equal(await second.locator(".cards > li").count(), 0, "logout clears other tabs");
      assert.deepEqual(errors, []);
      results.push({ width, theme, passed: true });
      console.log(`PASS website ${width}px ${theme}`);
      await context.close();
    }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ productionHost: false, realGoogleOAuth: false, results }, null, 2),
  );
} finally {
  await browser?.close();
  await server.close();
}
