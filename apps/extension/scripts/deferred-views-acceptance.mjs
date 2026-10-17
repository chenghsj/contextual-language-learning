// Run against a report from benchmark-load.mjs: actual production-mode modules, simulated Host.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { chromium } from "playwright";

assert.ok(process.argv[2], "Usage: node scripts/deferred-views-acceptance.mjs LOAD_REPORT.json");
const report = JSON.parse(await readFile(process.argv[2], "utf8"));
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await preview({
  root,
  configFile: join(root, "vite.config.ts"),
  build: { outDir: join(report.artifactsDir, "release") },
  preview: { host: "127.0.0.1", port: 0 },
  logLevel: "warn",
});
const chunk = module => {
  const found = report.graphs.release.find(item =>
    item.modules.some(entry => entry.id.endsWith(module)),
  );
  assert.ok(found, "Missing production module: " + module);
  return found.file;
};
const deferred = [
  "subtitle-editor",
  "custom-viewer",
  "speech-settings",
  "pi-settings",
  "drive-backup-settings",
].map(name => chunk("/components/" + name + ".tsx"));
const subtitleChunk = chunk("/components/subtitle-editor.tsx");
let browser;
const pageErrors = new WeakMap();
const deadline = setTimeout(() => {
  console.error("Deferred-view acceptance exceeded 90 seconds");
  process.exit(1);
}, 90_000);
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  async function open(query = "") {
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    page.setDefaultTimeout(10_000);
    const errors = [];
    pageErrors.set(page, errors);
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript({
      content: await readFile(join(report.artifactsDir, "fixture-setup.js"), "utf8"),
    });
    await page.goto(server.resolvedUrls.local[0] + "sidepanel.html?motion=reduced" + query);
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    return page;
  }
  async function close(page) {
    try {
      assert.deepEqual(pageErrors.get(page), []);
    } finally {
      await page.close();
    }
  }
  const page = await open();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const initial = await page.evaluate(() =>
    performance.getEntriesByType("resource").map(entry => new URL(entry.name).pathname),
  );
  for (const file of deferred)
    assert.ok(!initial.includes("/" + file), file + " loaded before use");
  await page.locator("#page-nav-lessons").click();
  const search = page.locator("#page-panel-lessons").getByRole("searchbox");
  await search.fill("original");
  await page.locator("#page-nav-create").click();
  await page.locator("#page-nav-lessons").click();
  assert.equal(await search.inputValue(), "original", "catalog state survives navigation");
  await page.locator("#header-settings").click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await sheet.getByRole("button", { name: /^一般/ }).click();
  await sheet.locator('section[aria-label="系統朗讀"]').waitFor();
  await sheet.getByRole("button", { name: "設定", exact: true }).click();
  await sheet.getByRole("button", { name: /^AI 與模型/ }).click();
  await sheet.locator('[data-ui="piSettings"]').waitFor();
  await sheet.getByRole("button", { name: "設定", exact: true }).click();
  await sheet.getByRole("button", { name: /^教材與備份/ }).click();
  await sheet.locator('[data-ui="driveBackup"]').waitFor();
  assert.deepEqual(errors, []);
  await close(page);
  console.log(
    "PASS production chunks load on use; catalog filters survive; general and AI settings open",
  );

  const custom = await open();
  await custom.getByRole("button", { name: "下一步", exact: true }).click();
  await custom.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
  await custom.getByRole("textbox", { name: "Prompt", exact: true }).fill("Explain the source.");
  await custom.getByRole("button", { name: "下一步", exact: true }).click();
  await custom
    .locator("#page-panel-create")
    .getByRole("button", { name: "建立內容", exact: true })
    .click();
  await custom
    .locator("[data-sonner-toast]")
    .getByRole("button", { name: "開啟教材", exact: true })
    .last()
    .click();
  await custom.getByRole("heading", { name: "Acceptance notes" }).waitFor();
  assert.equal(await custom.locator("article img").count(), 0);
  assert.equal(await custom.locator('a[href^="javascript:"]').count(), 0);
  const download = custom.waitForEvent("download");
  await custom.locator("#custom-reader-options").click();
  await custom.getByRole("button", { name: "匯出 Markdown", exact: true }).click();
  assert.equal((await download).suggestedFilename(), "Acceptance video.md");
  await custom.keyboard.press("Escape");
  await custom
    .locator('[data-ui="customReader"] > header')
    .getByRole("button", { name: "回到內容庫", exact: true })
    .click();
  await custom.waitForFunction(() => document.activeElement?.id === "page-nav-lessons");
  assert.equal(
    await custom.getByRole("tooltip").count(),
    0,
    "return focus must not show a tooltip",
  );
  await custom.locator("#page-nav-create").click();
  await custom.locator('[data-ui="create-steps"] button').nth(1).click();
  assert.equal(
    await custom.getByRole("textbox", { name: "Prompt", exact: true }).inputValue(),
    "Explain the source.",
  );
  assert.equal(
    await custom.evaluate(
      () => window.acceptance.commands.filter(command => command.type === "generateCustom").length,
    ),
    1,
  );
  await close(custom);
  console.log(
    "PASS deferred Markdown renders safely, exports, restores focus and preserves the Create draft",
  );

  const delayed = await open();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  await delayed.route("**/" + subtitleChunk, async route => {
    await gate;
    await route.continue();
  });
  try {
    await delayed.getByRole("button", { name: "預覽字幕", exact: true }).click();
    const loading = delayed.getByRole("status").filter({ hasText: "讀取中…" });
    await loading.waitFor();
    await loading.getByRole("button", { name: "關閉預覽", exact: true }).click();
    await delayed.getByRole("button", { name: "預覽字幕", exact: true }).waitFor();
    release();
    await delayed.getByRole("button", { name: "預覽字幕", exact: true }).click();
    await delayed.locator('[data-ui="subtitle-editor"]').waitFor();
  } finally {
    release();
    await close(delayed);
  }
  console.log("PASS slow chunk keeps a working back action and can open after loading");

  const failed = await open();
  await failed.route("**/" + subtitleChunk, route => route.abort(), { times: 1 });
  await failed.getByRole("button", { name: "預覽字幕", exact: true }).click();
  const failure = failed.getByRole("alert").filter({ hasText: "無法開啟這個畫面" });
  await failure.waitFor();
  await failure.getByRole("button", { name: "關閉預覽", exact: true }).click();
  await failed.locator("#page-nav-lessons").click();
  await failed.locator('#page-panel-lessons [data-ui="library-entry"]').first().waitFor();
  await failed.locator("#page-nav-create").click();
  await failed.getByRole("button", { name: "預覽字幕", exact: true }).click();
  await failed.getByRole("alert").getByRole("button", { name: "重新載入", exact: true }).click();
  await failed.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
  await failed.getByRole("button", { name: "預覽字幕", exact: true }).click();
  await failed.locator('[data-ui="subtitle-editor"]').waitFor();
  await close(failed);
  console.log("PASS failed chunk is contained; navigation survives; explicit reload recovers");

  const running = await open("&activityQueue=1");
  await running.getByRole("button", { name: "下一步", exact: true }).click();
  await running.getByRole("button", { name: "下一步", exact: true }).click();
  await running
    .locator("#page-panel-create")
    .getByRole("button", { name: "建立內容", exact: true })
    .click();
  await running.waitForFunction(() =>
    [...window.acceptance.jobs.values()].some(job => job.status === "running"),
  );
  const jobId = await running.evaluate(
    () => [...window.acceptance.jobs.values()].find(job => job.status === "running").id,
  );
  await running.locator('[data-ui="create-steps"] button').first().click();
  let releaseRunning;
  const runningGate = new Promise(resolve => {
    releaseRunning = resolve;
  });
  await running.route("**/" + subtitleChunk, async route => {
    await runningGate;
    await route.continue();
  });
  try {
    await running.getByRole("button", { name: "預覽字幕", exact: true }).click();
    const loading = running.getByRole("status").filter({ hasText: "讀取中…" });
    await loading.waitFor();
    await running.evaluate(id => window.acceptance.finishGeneration(id), jobId);
    await loading.getByRole("button", { name: "關閉預覽", exact: true }).click();
    releaseRunning();
    await running.getByRole("button", { name: "預覽字幕", exact: true }).click();
    await running.locator('[data-ui="subtitle-editor"]').waitFor();
    const state = await running.evaluate(
      id => ({
        status: window.acceptance.jobs.get(id)?.status,
        requests: window.acceptance.commands.filter(command => command.type === "generate").length,
        cancels: window.acceptance.commands.filter(command =>
          ["cancel", "cancelCustom"].includes(command.type),
        ).length,
      }),
      jobId,
    );
    assert.deepEqual(state, { status: "completed", requests: 1, cancels: 0 });
    assert.equal(
      await running.locator('[data-ui="unifiedReader"]:visible').count(),
      0,
      "late import must not change the selected view",
    );
  } finally {
    releaseRunning();
    await close(running);
  }
  console.log(
    "PASS generation settles during a pending view import without cancellation, resubmission or navigation",
  );
} finally {
  clearTimeout(deadline);
  await browser?.close();
  server.httpServer.closeAllConnections();
  await new Promise(resolve => server.httpServer.close(resolve));
}
