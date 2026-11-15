import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../../../.audit/drive-oauth-cancellation/", import.meta.url));
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
  const context = await browser.newContext({ viewport: { width: 480, height: 900 } });
  await context.route("https://accounts.google.com/o/oauth2/v2/auth**", route =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<title>Synthetic Google OAuth</title><h1>Google 授權測試</h1>",
    }),
  );
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    let api;
    window.oauthCancellation = { requests: 0, cancellations: 0, connected: false };
    Object.defineProperty(window, "chrome", {
      configurable: true,
      get: () => api,
      set: value => {
        value.tabs.create = async options => {
          const popup = window.open(options.url);
          if (!popup) throw new Error("Synthetic popup could not open");
          const id = 42;
          const timer = setInterval(() => {
            if (!popup.closed) return;
            clearInterval(timer);
            value.tabs.onRemoved.fire(id);
          }, 20);
          return { id };
        };
        value.tabs.remove = async () => {};
        const connect = value.runtime.connectNative;
        value.runtime.connectNative = (...args) => {
          const port = connect(...args),
            send = port.postMessage;
          let loginId;
          port.postMessage = request => {
            if (request.type === "driveValidate" && !window.oauthCancellation.connected) {
              queueMicrotask(() =>
                port.onMessage.fire({
                  id: request.id,
                  type: "error",
                  message: "Google OAuth Token 交換失敗（HTTP 400，invalid_grant）",
                }),
              );
              return;
            }
            if (request.type === "driveConnect") {
              loginId = request.id;
              window.oauthCancellation.requests++;
              if (window.oauthCancellation.requests === 1)
                queueMicrotask(() =>
                  port.onMessage.fire({
                    id: request.id,
                    type: "driveAuth",
                    url: "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic",
                  }),
                );
              else {
                window.oauthCancellation.connected = true;
                queueMicrotask(() =>
                  port.onMessage.fire({
                    id: request.id,
                    type: "driveConnected",
                    account: { id: "drive-preview", email: "learner@example.test" },
                  }),
                );
              }
              return;
            }
            if (request.type === "driveAuthCancel") {
              window.oauthCancellation.cancellations++;
              queueMicrotask(() =>
                port.onMessage.fire({
                  id: loginId,
                  type: "error",
                  message: "Google authorization was declined",
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
  const reconnect = backup.getByRole("button", { name: "重新連結 Google 帳號", exact: true });
  await reconnect.waitFor();
  await backup
    .getByRole("status")
    .filter({ hasText: "請重新連結 Google 帳號以更新雲端內容。" })
    .waitFor();
  assert.equal(await backup.getByText(/invalid_grant/).count(), 0);
  await backup.getByRole("button", { name: "查看詳細資料", exact: true }).click();
  await backup.getByText(/invalid_grant/).waitFor();
  await backup.getByRole("button", { name: "收合詳細資料", exact: true }).click();
  assert.equal(await backup.getByText(/invalid_grant/).count(), 0);
  assert.equal(await backup.locator('[data-ui="backup-existing-button"]').count(), 0);
  const popupPromise = context.waitForEvent("page");
  await reconnect.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  console.log("Synthetic OAuth popup", popup.url(), await popup.title());
  await popup.getByRole("heading", { name: "Google 授權測試" }).waitFor();
  assert.equal(await reconnect.isEnabled(), false);
  await popup.close();
  await reconnect.waitFor();
  await page.waitForFunction(() => window.oauthCancellation.cancellations === 1);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[data-ui="driveBackup"] button')).some(
      button => button.textContent === "重新連結 Google 帳號" && !button.disabled,
    ),
  );
  assert.equal(
    await reconnect.isEnabled(),
    true,
    "closing OAuth promptly restores retry without waiting for timeout",
  );
  assert.equal(await backup.getByRole("switch", { name: "自動備份新教材" }).isChecked(), false);
  assert.equal(await backup.locator('[data-ui="backup-existing-button"]').count(), 0);
  assert.equal(await backup.locator('[data-ui="backup-retry-button"]').count(), 0);
  await page.screenshot({ path: output + "cancelled-retry.png", fullPage: true });
  await reconnect.click();
  await page.waitForFunction(() => window.oauthCancellation.requests === 2);
  await page.waitForFunction(
    () => document.querySelector('[data-ui="backup-existing-button"]')?.disabled === false,
  );
  assert.equal(await backup.getByRole("switch", { name: "自動備份新教材" }).isChecked(), true);
  assert.equal(
    await backup
      .getByText("Google OAuth Token 交換失敗（HTTP 400，invalid_grant）", { exact: true })
      .count(),
    0,
  );
  await page.screenshot({ path: output + "retry-connected.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS actual App + worker: close owned OAuth tab, one Host cancellation, idle controls, unchanged disabled backup, immediate retry and successful validation",
  );
} finally {
  await browser?.close();
  await server.close();
}
