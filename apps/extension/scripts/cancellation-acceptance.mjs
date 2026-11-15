import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Actual App and worker; delay Host replies without calling a real AI provider.
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 400, 480])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        const control = { generation: null, cancellation: null, requests: [] };
        window.cancellationTest = control;
        Object.defineProperty(window, "chrome", {
          configurable: true,
          set(value) {
            const connect = value.runtime.connectNative;
            value.runtime.connectNative = (...args) => {
              const port = connect(...args),
                send = port.postMessage;
              const reply = message => queueMicrotask(() => port.onMessage.fire(message));
              port.postMessage = request => {
                if (request.type === "generateCustom") {
                  const now = new Date().toISOString();
                  const job = {
                    id: request.payload.id,
                    kind: "custom",
                    status: "running",
                    sourceTitle: request.payload.source.title,
                    provider: "openai",
                    completed: 0,
                    total: 1,
                    createdAt: now,
                    updatedAt: now,
                  };
                  window.acceptance.jobs.set(job.id, job);
                  control.generation = { request, reply, job };
                  reply({ id: request.id, type: "job", job });
                } else if (request.type === "cancelCustom") {
                  control.requests.push(request);
                  control.cancellation = { request, reply };
                } else send(request);
              };
              return port;
            };
            Object.defineProperty(window, "chrome", { configurable: true, writable: true, value });
          },
        });
      });
      await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?theme=" + theme);
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
      await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Explain the source.");
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page
        .locator("#page-panel-create")
        .getByRole("button", { name: "建立內容", exact: true })
        .click();
      await page.waitForFunction(() => window.cancellationTest.generation);
      await page.getByRole("button", { name: "取消生成", exact: true }).click();
      const notice = page.locator('[data-ui="cancellationStatus"]');
      await notice.filter({ hasText: "取消中" }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "取消中…", exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await page.evaluate(() => window.cancellationTest.generation.job.status),
        "running",
      );
      await page.evaluate(() => {
        const { request, reply } = window.cancellationTest.cancellation;
        reply({
          id: request.id,
          type: "error",
          message: "Cancellation is not confirmed: still stopping",
        });
      });
      await notice.filter({ hasText: "取消尚未確認" }).waitFor();
      await notice.getByRole("button", { name: "重試取消", exact: true }).click();
      await notice.filter({ hasText: "取消中" }).waitFor();
      await page.waitForFunction(() => window.cancellationTest.requests.length === 2);
      assert.equal(
        await page.evaluate(() => {
          const [first, second] = window.cancellationTest.requests;
          return first.id !== second.id && first.jobId === second.jobId;
        }),
        true,
      );
      await page.evaluate(() => {
        const { generation, cancellation } = window.cancellationTest;
        generation.job = { ...generation.job, status: "cancelled" };
        window.acceptance.jobs.set(generation.job.id, generation.job);
        generation.reply({ id: generation.request.id, type: "job", job: generation.job });
        generation.reply({
          id: generation.request.id,
          type: "error",
          message: "AI aborted after cleanup",
        });
        cancellation.reply({ id: cancellation.request.id, type: "cancelled" });
      });
      await notice.waitFor({ state: "hidden" });
      assert.equal(await page.getByText("AI aborted after cleanup", { exact: true }).count(), 0);
      await page.locator("#header-activity").click();
      const sheet = page.getByRole("dialog");
      await sheet.getByText("已取消", { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      console.log(`Cancellation confirmed after retry: ${width}px ${theme}`);
      await page.close();
    }
} finally {
  await browser?.close();
  await server.close();
}
