// Real Dialog components with the development video/Host fixture.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-dialog-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5192, strictPort: true, hmr: false, watch: null },
});

async function assertMotion(page, reduced) {
  const animations = await page.locator('[data-slot="dialog-content"]').evaluate(el => ({
    content: getComputedStyle(el).animationName,
    overlay: getComputedStyle(document.querySelector('[data-slot="dialog-overlay"]')).animationName,
  }));
  assert.deepEqual(animations, {
    content: reduced ? "none" : "enter",
    overlay: reduced ? "none" : "enter",
  });
}

async function closePosition(sheet) {
  return sheet.getByRole("button", { name: "關閉", exact: true }).evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return { x: Math.round(bounds.x), y: Math.round(bounds.y) };
  });
}

async function assertSheetHeader(page, width, theme, reduced) {
  await page.setViewportSize({ width, height: 320 });
  await page.locator("#header-settings").click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await sheet.evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished));
  });
  const header = sheet.locator('[data-ui="sheet-header"]');
  const scroll = sheet.locator('[data-ui="sheet-scroll"]');
  const position = await closePosition(sheet);
  for (const section of ["一般", "AI 與模型", "教材與備份", "本機服務"]) {
    await sheet.getByRole("button", { name: new RegExp("^" + section) }).click();
    await header
      .getByRole("heading", { name: section, exact: true })
      .waitFor()
      .catch(async error => {
        console.log("Page:", await page.locator("body").innerText());
        await page.screenshot({ path: join(output, "failure.png") });
        console.log("Evidence:", output);
        throw error;
      });
    assert.deepEqual(
      await closePosition(sheet),
      position,
      "close stays at the same position on a subpage",
    );
    const scrolled = await scroll.evaluate(el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    if (section === "教材與備份") {
      assert.ok(scrolled > 0, "exercise a real scrolling settings page");
      if (!reduced) await sheet.screenshot({ path: join(output, `sheet-${width}-${theme}.png`) });
    }
    assert.deepEqual(await closePosition(sheet), position, "content scrolling must not move close");
    await header.getByRole("button", { name: "設定", exact: true }).click();
    await header.getByRole("heading", { name: "設定", exact: true }).waitFor();
    assert.deepEqual(await closePosition(sheet), position);
  }
  await sheet.getByRole("button", { name: "關閉", exact: true }).click();
  await sheet.waitFor({ state: "detached" });

  await page.evaluate(() => {
    const now = new Date().toISOString();
    const id = "00000000-0000-4000-8000-000000000111";
    window.acceptance.jobs.set(id, {
      id,
      sourceTitle: "Header acceptance",
      provider: "openai",
      status: "failed",
      completed: 0,
      total: 4,
      createdAt: now,
      updatedAt: now,
    });
  });
  await page.locator("#header-activity").click();
  await sheet.waitFor();
  await sheet.evaluate(async el => {
    await Promise.all(el.getAnimations().map(animation => animation.finished));
  });
  const activityPosition = await closePosition(sheet);
  await sheet.locator('[data-ui="taskHistoryItem"] button[aria-expanded]').first().click();
  const details = sheet.getByRole("button", { name: "執行詳情", exact: true });
  await details.click();
  await header.getByRole("heading", { name: "執行詳情", exact: true }).waitFor();
  assert.deepEqual(await closePosition(sheet), activityPosition);
  await scroll.evaluate(el => {
    el.scrollTop = el.scrollHeight;
  });
  assert.deepEqual(await closePosition(sheet), activityPosition);
  await header.getByRole("button", { name: "活動", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent === "執行詳情");
  assert.equal(await details.evaluate(el => el === document.activeElement), true);
  await sheet.getByRole("button", { name: "關閉", exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  await page.setViewportSize({ width, height: 800 });
}

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 640])
    for (const theme of ["light", "dark"])
      for (const reduced of [false, true]) {
        const page = await browser.newPage({
          viewport: { width, height: 800 },
          reducedMotion: reduced ? "reduce" : "no-preference",
        });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:5192/dev/redesign-preview.html?theme=${theme}`);
        await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
        await assertSheetHeader(page, width, theme, reduced);
        await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
        const editor = page.locator('[data-ui="subtitle-editor"]');
        const trigger = editor.getByRole("button", { name: "修改", exact: true }).first();
        const dialog = page.getByRole("dialog");
        for (const close of ["完成", "關閉", "Escape"]) {
          await trigger.click();
          await dialog.waitFor();
          await assertMotion(page, reduced);
          if (close === "Escape") await page.keyboard.press("Escape");
          else await dialog.getByRole("button", { name: close, exact: true }).click();
          await dialog.waitFor({ state: "detached" });
          await page.waitForFunction(() => document.activeElement?.textContent === "修改");
          assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
        }

        // Editing a filtered cue can unmount the button that opened the dialog.
        const search = editor.getByRole("textbox", { name: "搜尋字幕", exact: true });
        await search.fill("Line 1:");
        await trigger.click();
        await dialog
          .getByRole("textbox", { name: "字幕文字", exact: true })
          .fill("Changed caption");
        await dialog.getByRole("button", { name: "完成", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.waitForFunction(
          () =>
            document.activeElement === document.querySelector('[data-ui="subtitle-editor"] input'),
        );
        assert.equal(await search.evaluate(el => el === document.activeElement), true);
        await search.fill("");
        await editor.getByRole("button", { name: "返回影片", exact: true }).click();

        await page.getByRole("button", { name: "下一步", exact: true }).click();
        await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
        await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Dialog acceptance");
        const add = page.getByRole("button", { name: "新增範本", exact: true });
        await add.click();
        await dialog.waitFor();
        await assertMotion(page, reduced);
        const name = "W".repeat(100);
        await dialog.getByRole("textbox", { name: "名稱", exact: true }).fill(name);
        await dialog.getByRole("button", { name: "儲存範本", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "範本管理", exact: true }).click();
        const remove = page.getByRole("button", { name: "刪除 · " + name, exact: true });
        await remove.click();
        await dialog.waitFor();
        // Wait until the normal zoom animation finishes before measuring layout.
        await dialog.evaluate(async el => {
          await Promise.all(el.getAnimations().map(animation => animation.finished));
        });
        const layout = await dialog.evaluate(el => {
          const bounds = el.getBoundingClientRect();
          const close = el.querySelector('[data-slot="dialog-close"]').getBoundingClientRect();
          return {
            overflow: el.scrollWidth > el.clientWidth,
            closeInside: close.left >= bounds.left && close.right <= bounds.right,
          };
        });
        assert.deepEqual(layout, { overflow: false, closeInside: true });
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        if (!reduced) {
          const content = page.locator('[data-slot="dialog-content"][data-state="closed"]');
          const animations = await content.evaluate(el => ({
            content: getComputedStyle(el).animationName,
            overlay: getComputedStyle(document.querySelector('[data-slot="dialog-overlay"]'))
              .animationName,
          }));
          assert.deepEqual(animations, { content: "exit", overlay: "exit" });
        }
        await dialog.waitFor({ state: "detached" });
        await page.waitForFunction(() =>
          document.activeElement?.getAttribute("aria-label")?.startsWith("刪除 · "),
        );
        assert.equal(await remove.evaluate(el => el === document.activeElement), true);
        assert.deepEqual(errors, []);
        await page.close();
        console.log(
          "PASS fixed Sheet header, dialog focus, filtered cue fallback, long title and motion",
          width,
          theme,
          reduced,
        );
      }
  console.log("Evidence:", output);
} finally {
  await browser?.close();
  await server.close();
}
