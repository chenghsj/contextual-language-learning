import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
const output = await mkdtemp(join(tmpdir(), "cll-dynamic-progress-ui-"));
const jobId = "db39209f-ff43-4683-9bb4-a1796895f995";
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 1000])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } }),
        errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?theme=" + theme);
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      await page.evaluate(id => {
        const now = new Date().toISOString();
        window.acceptance.jobs.set(id, {
          id,
          status: "running",
          phase: "creating",
          sourceTitle: "日語影片教材",
          provider: "antigravity",
          completed: 9,
          total: 11,
          createdAt: now,
          updatedAt: now,
          execution: {
            schemaVersion: "6",
            workflowVersion: "learning-points-v6-2",
            promptVersion: "learning-points-prompts-5",
            inputFingerprint: "a".repeat(64),
            provider: "antigravity",
            modelId: "gemini-3.7-flash",
            contextWindow: 1048576,
            maxOutputTokens: 65536,
          },
        });
      }, jobId);
      await page.locator("#header-activity").click();
      const refresh = page.getByRole("button", { name: "重新整理任務", exact: true });
      await refresh.click();
      const item = page.locator('[data-ui="taskHistoryItem"]').filter({ hasText: "日語影片教材" });
      await item.waitFor();
      await item.locator("h3 button").click();
      const progress = item.locator('[data-ui="jobProgress"]');
      await progress.getByText("已完成 9 個生成步驟", { exact: true }).waitFor();
      for (const total of [12, 13]) {
        await page.evaluate(
          ({ id, total }) => {
            const job = window.acceptance.jobs.get(id);
            job.total = total;
            job.completed = 10;
          },
          { id: jobId, total },
        );
        await refresh.click();
        await progress.getByText("已完成 10 個生成步驟", { exact: true }).waitFor();
        assert.equal(await progress.locator('[role="progressbar"]').count(), 0);
        assert.equal(await item.locator('[data-ui="jobStage"]').count(), 1);
        assert.equal(await item.locator('[data-ui="jobStage"]').innerText(), "建立教材內容");
        assert.equal(await item.locator('[data-ui="jobStage"] svg.animate-spin').count(), 1);
        assert.doesNotMatch(await progress.innerText(), /\d+\s*[/／]\s*\d+/);
      }
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(output, `${width}-${theme}.png`) });
      await page.close();
    }
  console.log(
    JSON.stringify({
      result: "passed",
      widths: [320, 1000],
      themes: ["light", "dark"],
      artifacts: output,
      host: "simulated preview only",
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
