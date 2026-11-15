import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-unrestricted-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
async function settle(page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})),
    );
  });
}
async function importJapanese(page) {
  const importButton = page.getByRole("button", { name: "自行匯入字幕", exact: true });
  if ((await importButton.getAttribute("aria-expanded")) === "false") await importButton.click();
  await page.getByRole("tab", { name: "貼上文字", exact: true }).click();
  await page
    .getByRole("textbox", { name: "貼上字幕", exact: true })
    .fill("もう食べた？\nまだ食べていない。");
  await page.getByRole("button", { name: "使用貼上的字幕", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
}
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 555]) {
    const page = await browser.newPage({ viewport: { width, height: 760 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?motionAcceptance=1");
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    const level = page.getByRole("combobox", { name: "你的語言程度", exact: true });
    assert.match(await level.innerText(), /B1/);
    await level.click();
    assert.equal(await page.getByRole("option").count(), 7);
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
    await page.keyboard.press("End");
    await page.waitForFunction(() => document.activeElement?.textContent === "不限程度");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => document.getElementById("learning-level")?.textContent === "不限程度",
    );
    assert.equal(await level.innerText(), "不限程度");
    await page.waitForFunction(() => document.activeElement?.id === "learning-level");
    await page.getByRole("button", { name: "設定說明： 你的語言程度", exact: true }).click();
    const help = page.locator('[data-slot="popover-content"]');
    await help.waitFor();
    assert.match(await help.innerText(), /難度可能混合/);
    assert.doesNotMatch(await help.innerText(), /unrestricted/);
    await settle(page);
    await page.screenshot({ path: join(output, `help-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await level.click();
    await settle(page);
    await page.screenshot({ path: join(output, `options-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        JSON.parse(sessionStorage.getItem("motion-acceptance-preferences"))?.profile.level ===
        "unrestricted",
    );
    await page.reload();
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    if (!(await level.isVisible()))
      await page.getByRole("button", { name: "下一步", exact: true }).click();
    assert.equal(await level.innerText(), "不限程度");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    assert.match(await page.locator("#page-panel-create").innerText(), /標準教材 · 不限程度/);
    await page.locator("#page-panel-create nav button").first().click();
    await page.getByRole("combobox", { name: "學習語言", exact: true }).click();
    await page.getByRole("option", { name: "日語", exact: true }).click();
    await page.waitForFunction(() => {
      const profile = JSON.parse(sessionStorage.getItem("motion-acceptance-preferences"))?.profile;
      return profile?.targetLanguage === "ja" && profile?.level === "unrestricted";
    });
    await importJapanese(page);
    assert.equal(await level.innerText(), "不限程度");
    await level.click();
    assert.equal(await page.getByRole("option").count(), 6);
    await page.getByRole("option", { name: "N3 · 中級", exact: true }).click();
    assert.equal(await level.innerText(), "N3 · 中級");
    await page.locator("#page-panel-create nav button").first().click();
    await page.getByRole("combobox", { name: "學習語言", exact: true }).click();
    await page.getByRole("option", { name: "韓語", exact: true }).click();
    await page.waitForFunction(() => {
      const profile = JSON.parse(sessionStorage.getItem("motion-acceptance-preferences"))?.profile;
      return profile?.targetLanguage === "ko" && profile?.level === "2";
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    JSON.stringify({
      output,
      checks:
        "320/555px: keyboard selection, contextual help, confirmation, language switching, save/reload, graded selection, no overflow or page errors. App with simulated browser/Host; no live model call.",
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
