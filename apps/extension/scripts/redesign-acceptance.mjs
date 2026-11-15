import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Actual App and service worker; browser and Host responses are simulated by the dev fixture.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "contextual-redesign-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5176, strictPort: true },
});
await server.listen();
let browser;
async function run() {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const evidence = [];
  for (const width of [320, 360, 480])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto("http://127.0.0.1:5176/dev/redesign-preview.html?theme=" + theme);
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      const range = page.locator('section[aria-label="分析範圍"]');
      await range.getByRole("combobox").click();
      await page.getByRole("option", { name: "自訂", exact: true }).click();
      await range.getByRole("textbox", { name: "開始", exact: true }).fill("00:00:20.000");
      await range.getByRole("textbox", { name: "結束", exact: true }).fill("00:00:15.000");
      assert.equal(
        await page.getByRole("button", { name: "下一步", exact: true }).isDisabled(),
        true,
      );
      await range.getByRole("button", { name: "使用目前位置", exact: true }).first().click();
      await page.waitForFunction(
        element => element.value === "00:05.0",
        await range.getByRole("textbox", { name: "開始", exact: true }).elementHandle(),
      );
      assert.equal(
        await range.getByRole("textbox", { name: "開始", exact: true }).inputValue(),
        "00:05.0",
      );
      assert.equal(
        await page.getByRole("button", { name: "下一步", exact: true }).isDisabled(),
        false,
      );
      await page.screenshot({ path: `${output}/redesign-range-${width}-${theme}.png` });
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Prompt", exact: true })
        .fill("Create a concise source-grounded summary.");
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page
        .locator("#page-panel-create")
        .getByRole("button", { name: "建立內容", exact: true })
        .click();
      await page.waitForFunction(() => window.acceptance.docs.size > 0);
      assert.equal(await page.locator("#page-panel-create").isVisible(), true);
      await page
        .locator("[data-sonner-toast]")
        .getByRole("button", { name: "開啟教材", exact: true })
        .last()
        .click();
      await page.getByRole("heading", { name: "Acceptance notes" }).waitFor();
      const customAction = async label => {
        await page.locator("#custom-reader-options").click();
        await page.getByRole("button", { name: label, exact: true }).click();
      };
      assert.equal(await page.locator("article img").count(), 0);
      assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
      const generated = await page.evaluate(
        () => window.acceptance.commands.find(c => c.type === "generateCustom").payload,
      );
      assert.equal(generated.cues.length, 20);
      assert.equal(generated.cues[0].startMs, 5000);
      assert.equal(generated.analysisRange.endMs, 15000);
      await customAction("重新生成");
      const dialog = page.getByRole("dialog", { name: "重新生成", exact: true });
      await dialog.waitFor();
      assert.equal(await page.locator("article [role=dialog]").count(), 0);
      await page.screenshot({ path: `${output}/redesign-dialog-${width}-${theme}.png` });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.id === "custom-reader-options");
      assert.equal(
        await page.locator("#custom-reader-options").evaluate(e => e === document.activeElement),
        true,
      );
      await customAction("重新生成");
      await page.getByRole("dialog").getByRole("button", { name: "重新生成", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          window.acceptance.commands.filter(command => command.type === "generateCustom").length ===
            2 && window.acceptance.docs.size === 2,
      );
      assert.equal(await page.getByRole("heading", { name: "Acceptance notes" }).isVisible(), true);
      await page
        .locator("[data-sonner-toast]")
        .getByRole("button", { name: "開啟教材", exact: true })
        .last()
        .click();
      await page.getByRole("heading", { name: "Acceptance notes" }).waitFor();
      const regenerated = await page.evaluate(
        () =>
          window.acceptance.commands.filter(command => command.type === "generateCustom")[1]
            .payload,
      );
      assert.notEqual(regenerated.id, generated.id);
      assert.equal(regenerated.previousDocumentId, generated.id);
      assert.deepEqual(regenerated.cues, generated.cues);
      assert.equal(regenerated.agent.modelId, generated.agent.modelId);
      assert.equal(regenerated.prompt, generated.prompt);
      await customAction("改名");
      await page.getByRole("textbox", { name: "改名", exact: true }).fill("Renamed notes");
      await page.locator("form").getByRole("button", { name: "儲存", exact: true }).click();
      await page.getByRole("heading", { name: "Renamed notes" }).waitFor();
      const download = page.waitForEvent("download");
      await customAction("匯出 Markdown");
      assert.equal((await download).suggestedFilename(), "Renamed notes.md");
      await page.screenshot({ path: `${output}/redesign-viewer-${width}-${theme}.png` });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        "horizontal overflow",
      );
      await customAction("活動");
      const activityPanel = page.locator("#page-panel-activity");
      await activityPanel.waitFor();
      await activityPanel.locator('[data-ui="taskHistoryItem"] button').first().click();
      await activityPanel.getByRole("button", { name: "執行詳情", exact: true }).first().click();
      await page
        .getByRole("dialog")
        .getByRole("heading", { name: "執行詳情", exact: true })
        .waitFor();
      assert.equal(await page.getByRole("dialog").count(), 1);
      await page.getByRole("button", { name: "活動", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "關閉", exact: true }).click();
      await customAction("使用目前影片重用 Prompt");
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(),
        "Create a concise source-grounded summary.",
      );
      await page.locator("#page-nav-lessons").click();
      await page.getByRole("button", { name: "自訂內容", exact: true }).click();
      await page
        .locator("article")
        .filter({ has: page.getByRole("heading", { name: "Renamed notes", exact: true }) })
        .getByRole("button", { name: "開啟教材", exact: true })
        .click();
      await customAction("本機刪除");
      await page.getByRole("dialog").getByRole("button", { name: "本機刪除", exact: true }).click();
      await page.waitForFunction(() => window.acceptance.docs.size === 1);
      assert.equal(await page.evaluate(() => window.acceptance.docs.size), 1);
      assert.equal(await page.evaluate(() => window.acceptance.jobs.size), 2);
      assert.equal(
        await page.evaluate(() => {
          const deleted = window.acceptance.commands
            .filter(command => command.type === "deleteCustomDocument")
            .at(-1);
          return (
            !!deleted &&
            !window.acceptance.docs.has(deleted.documentId) &&
            window.acceptance.jobs.has(deleted.documentId)
          );
        }),
        true,
        "deleting local content preserves its task history",
      );
      await page.locator("#header-settings").click();
      for (const category of ["一般", "AI 與模型", "教材與備份", "本機服務"]) {
        await page.getByRole("button", { name: new RegExp("^" + category) }).click();
        try {
          await page.getByRole("heading", { name: category, exact: true }).waitFor();
        } catch (error) {
          console.log(await page.locator("body").innerText());
          console.log("Errors", errors);
          await page.screenshot({ path: join(output, "failure.png") });
          console.log("Evidence:", output);
          throw error;
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.screenshot({
          path: `${output}/redesign-settings-${category}-${width}-${theme}.png`,
        });
        await page.getByRole("button", { name: "設定", exact: true }).click();
      }
      assert.deepEqual(errors, []);
      evidence.push({
        width,
        theme,
        checks:
          "range, invalid bounds, cue ids/times, virtual subtitle editor, keyboard select, Portal/Escape/focus, generation/new versions, settings categories, safe Markdown, rename, export, prompt reuse, Activity, local deletion/history",
      });
      await page.close();
      console.log("PASS", width, theme);
    }
  const environment = {
    browser: browser.version(),
    node: process.version,
    platform: process.platform,
    at: new Date().toISOString(),
    fixture: "actual App/worker; simulated browser and Host responses",
  };
  await browser.close();
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify({ environment, scenarios: evidence }, null, 2),
  );
  console.log("Evidence:", output);
}
try {
  await run();
} finally {
  await browser?.close();
  await server.close();
}
