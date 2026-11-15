import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../../../.audit/backup-history/", import.meta.url));
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 403, 600])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        let api;
        const date = "2026-10-24T02:51:00.000Z";
        function job(title, status, error, at = date) {
          return {
            id: crypto.randomUUID(),
            sourceTitle: title,
            provider: "openai",
            status: "completed",
            completed: 1,
            total: 1,
            createdAt: at,
            updatedAt: at,
            backup: {
              accountId: "drive-preview",
              status,
              updatedAt: at,
              ...(error ? { error } : {}),
            },
          };
        }
        const jobs = [
          job("相反的你和我第 14 集：冬夜的兩難", "failed", "此教材版本已停止支援，請重新生成"),
          job(
            "畫完這個再去死 第10話【這個世界上90%都是渣滓～想變得比媽媽更強就需要「朋友」】｜Muse木棉花 動畫 線上看",
            "failed",
            "此教材版本已停止支援，請重新生成",
          ),
          job(
            "畫完這個再去死 第10話【這個世界上90%都是渣滓～想變得比媽媽更強就需要「朋友」】｜Muse木棉花 動畫 線上看",
            "failed",
            "此教材版本已停止支援，請重新生成",
          ),
          job("螢火蟲的出嫁 第03話【守望的老鼠】｜Muse木棉花 動畫 線上看", "backed-up"),
          job(
            "另一份待重試的教材",
            "failed",
            "Synthetic network failure: HTTP 503",
            "2026-10-23T00:00:00.000Z",
          ),
        ];
        window.historyTest = { jobs, retries: [] };
        Object.defineProperty(window, "chrome", {
          configurable: true,
          get: () => api,
          set: value => {
            const connect = value.runtime.connectNative;
            value.runtime.connectNative = (...args) => {
              const port = connect(...args),
                send = port.postMessage;
              port.postMessage = request => {
                if (request.type === "listJobs") {
                  queueMicrotask(() => port.onMessage.fire({ id: request.id, type: "jobs", jobs }));
                  return;
                }
                if (request.type === "retryBackup") {
                  window.historyTest.retries.push(request.jobId);
                  const record = jobs.find(job => job.id === request.jobId);
                  record.backup = { ...record.backup, status: "backed-up", error: undefined };
                  queueMicrotask(() =>
                    port.onMessage.fire({
                      id: request.id,
                      type: "backupPublished",
                      jobId: request.jobId,
                      location: "drive-preview",
                    }),
                  );
                  return;
                }
                send(request);
              };
              return port;
            };
            api = value;
          },
        });
      });
      await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?drive=1");
      await page.locator("#header-settings").click();
      const sheet = page.locator('[data-slot="sheet-content"]');
      await sheet.getByRole("button", { name: /^教材與備份/ }).click();
      const backup = sheet.locator('[data-ui="driveBackup"]');
      await backup.getByText("1 份備份失敗", { exact: true }).waitFor();
      await backup.getByRole("button", { name: "備份紀錄 · 5", exact: true }).click();
      const current = backup.locator('[data-ui="backup-history-current"]');
      await current.locator("li").nth(1).waitFor();
      assert.equal(await current.locator("li").count(), 2);
      assert.ok(
        (await current.locator("li").first().innerText()).includes("螢火蟲"),
        "latest valid backup comes first",
      );
      assert.equal(
        await backup.getByText("此教材版本已停止支援，請重新生成", { exact: true }).count(),
        0,
      );
      assert.equal(
        await backup.getByText("Synthetic network failure: HTTP 503", { exact: true }).count(),
        0,
      );
      await backup.getByRole("button", { name: "查看詳細資料", exact: true }).click();
      await backup.getByText("Synthetic network failure: HTTP 503", { exact: true }).waitFor();
      await backup.getByRole("button", { name: "收合詳細資料", exact: true }).click();
      const geometry = await current
        .locator("li")
        .first()
        .locator("p")
        .first()
        .evaluate(node => {
          const rect = node.getBoundingClientRect(),
            style = getComputedStyle(node);
          return {
            width: rect.width,
            height: rect.height,
            lineHeight: parseFloat(style.lineHeight),
          };
        });
      assert.ok(geometry.height <= geometry.lineHeight * 2 + 1, "titles are limited to two lines");
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        "no horizontal overflow",
      );
      await page.screenshot({ path: output + `${width}-${theme}.png`, fullPage: true });
      await backup.getByRole("button", { name: "舊版教材 · 3", exact: true }).click();
      const retired = backup.locator('[data-ui="backup-history-retired"]');
      await retired.locator("li").nth(2).waitFor();
      assert.equal(await retired.getByText("舊版・略過備份", { exact: true }).count(), 3);
      await backup.getByRole("button", { name: "重試失敗項目", exact: true }).click();
      await page.waitForFunction(() => window.historyTest.retries.length === 1);
      const result = await page.evaluate(() => ({
        retries: window.historyTest.retries,
        expected: window.historyTest.jobs.find(job => job.sourceTitle === "另一份待重試的教材").id,
      }));
      assert.deepEqual(result.retries, [result.expected], "retry excludes archived lessons");
      assert.deepEqual(errors, []);
      console.log(
        `PASS backup history ${width}px ${theme}: scan order, collapsed retired group, details, title clamping, retry targets`,
      );
      await context.close();
    }
} finally {
  await browser?.close();
  await server.close();
}
