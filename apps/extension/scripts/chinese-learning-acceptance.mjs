import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-chinese-learning-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480]) {
    for (const [language, label, answer, notation, reading] of [
      ["zh-TW", "中文（台灣／繁體）", "我要買兩杯茶。", "注音", "ㄌㄧㄤˇ ㄅㄟ"],
      ["zh-CN", "中文（中國／簡體）", "我要买两杯茶。", "漢語拼音", "liǎng bēi"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base + "dev/redesign-preview.html");
      await page.getByRole("combobox", { name: "學習語言", exact: true }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await page.locator('[data-ui="subtitleState"][data-state="error"]').waitFor();
      const other = page.getByRole("button", { name: "自行匯入字幕", exact: true });
      if ((await other.getAttribute("aria-expanded")) === "false") await other.click();
      await page.getByRole("tab", { name: "貼上文字", exact: true }).click();
      await page.getByRole("textbox", { name: "貼上字幕", exact: true }).fill(answer);
      await page.getByRole("button", { name: "使用貼上的字幕", exact: true }).click();
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      const level = page.getByRole("combobox", { name: "你的語言程度", exact: true });
      await level.click();
      assert.equal(await page.getByRole("option").count(), 7);
      await page.getByRole("option", { name: /A2/ }).click();
      await page.screenshot({
        path: join(output, `${language}-settings-${width}.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await page.goto(base + `dev/reader-preview.html?chinese=${language}`);
      await page.getByRole("button", { name: "發音標註", exact: true }).click();
      await page.getByRole("radio", { name: notation, exact: true }).waitFor();
      assert.equal(await page.getByRole("radio").count(), 2);
      await page.getByRole("radio", { name: notation, exact: true }).click();
      await page.keyboard.press("Escape");
      assert.ok((await page.locator("body").innerText()).includes(reading));
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: join(output, `${language}-reader-${width}.png`),
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(
    JSON.stringify({
      output,
      checks:
        "320/480px, Chinese study choices, imported source, A1-C2 levels, saved Zhuyin/Pinyin reading, no overflow or page errors; simulated App/Host, synthetic reader",
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
