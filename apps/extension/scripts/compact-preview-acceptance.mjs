import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "../../work/compact-preview-ui-20261102");
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
const checks = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const viewport of [
    { width: 417, height: 780 },
    { width: 960, height: 900 },
  ]) {
    const page = await browser.newPage({ viewport }),
      errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?compactPreview=1");
    await page.locator("#header-activity").click();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor();
    await sheet.locator('[data-ui="taskHistoryItem"] button').first().click();
    await sheet.getByRole("button", { name: /閱讀已完成場景/ }).click();
    const banner = page.locator('[data-ui="generationPreview"]');
    await banner.waitFor();
    await sheet.waitFor({ state: "hidden" });
    assert.match(await banner.innerText(), /1／2/);
    const sentences = page.locator('[data-ui="sourceSentence"]');
    await sentences.first().waitFor();
    const before = await sentences.allTextContents();
    await page.screenshot({ path: join(output, `${viewport.width}-partial.png`), fullPage: true });
    const refresh = async () => {
      await page.locator("#reader-options:visible").first().click();
      await page.getByRole("button", { name: "活動", exact: true }).last().click();
      await sheet.waitFor();
      await sheet.getByRole("button", { name: "重新整理任務", exact: true }).click();
    };
    await page.evaluate(() => window.advanceCompactPreview(false));
    await refresh();
    await page.waitForFunction(() =>
      document.querySelector('[data-ui="generationPreview"]')?.textContent.includes("2／2"),
    );
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    assert.deepEqual(
      await sentences.allTextContents(),
      before,
      "inserting an earlier ready scene must preserve the current scene",
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.evaluate(() => window.advanceCompactPreview(true));
    await refresh();
    await banner.waitFor({ state: "detached" });
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    assert.deepEqual(await sentences.allTextContents(), before);
    await page.screenshot({ path: join(output, `${viewport.width}-complete.png`), fullPage: true });
    assert.deepEqual(errors, []);
    checks.push({ viewport, partialReader: true, stableScene: true, completion: true, errors });
    await page.close();
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(
      {
        checks,
        boundary:
          "Actual App/controller/reader with simulated Host and video; no model requests, installed Host or user-data writes.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ output, checks }));
} finally {
  await browser?.close();
  await server.close();
}
