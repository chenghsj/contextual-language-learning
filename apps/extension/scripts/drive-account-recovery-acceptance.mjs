import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 403, height: 900 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    let api;
    window.driveRecovery = { fail: true, reads: 0 };
    Object.defineProperty(window, "chrome", {
      configurable: true,
      get: () => api,
      set: value => {
        const connect = value.runtime.connectNative;
        value.runtime.connectNative = (...args) => {
          const port = connect(...args);
          const send = port.postMessage;
          port.postMessage = request => {
            if (request.type === "driveAccounts") {
              window.driveRecovery.reads++;
              if (window.driveRecovery.fail) {
                queueMicrotask(() =>
                  port.onMessage.fire({
                    id: request.id,
                    type: "error",
                    message: "合成測試：本機服務連線中斷",
                  }),
                );
                return;
              }
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
  await backup.getByText("合成測試：本機服務連線中斷", { exact: true }).waitFor();
  assert.equal(await backup.getByText(/尚未設定 Google OAuth/).count(), 0);
  await page.evaluate(() => {
    window.driveRecovery.fail = false;
  });
  await backup.getByRole("button", { name: "重試", exact: true }).click();
  await backup.locator("#drive-backup-account").waitFor();
  assert.equal(await backup.getByText(/尚未設定 Google OAuth/).count(), 0);
  assert.equal(await backup.getByText("合成測試：本機服務連線中斷").count(), 0);
  const before = await page.evaluate(() => window.driveRecovery.reads);
  await sheet.getByRole("button", { name: "設定", exact: true }).click();
  await page.evaluate(() => {
    window.driveRecovery.fail = true;
  });
  await sheet.getByRole("button", { name: /^教材與備份/ }).click();
  await backup.getByText("合成測試：本機服務連線中斷", { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.driveRecovery.reads)) > before);
  assert.equal(
    await backup.locator("#drive-backup-account").count(),
    1,
    "failed refresh retains the known account",
  );
  await page.evaluate(() => {
    window.driveRecovery.fail = false;
  });
  await backup.getByRole("button", { name: "重試", exact: true }).click();
  await backup.getByText("合成測試：本機服務連線中斷").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS actual App: account-read failure, retry, settings reopen and retained account; no false OAuth warning",
  );
} finally {
  await browser?.close();
  await server.close();
}
