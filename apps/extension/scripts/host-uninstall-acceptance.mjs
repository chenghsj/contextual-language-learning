import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-uninstall-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5180, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 400, 900])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 700 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("http://127.0.0.1:5180/dev/redesign-preview.html?theme=" + theme);
      await page.locator("#header-settings").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^本機服務/ })
        .click();
      const section = page.locator("[data-ui=hostUninstall]");
      await section.getByRole("button", { name: "解除安裝 Host", exact: true }).click();
      assert.equal(await section.getByRole("combobox").count(), 0);
      assert.equal(await section.locator("code").count(), 0);
      assert.ok((await section.boundingBox()).height < 220);
      assert.ok((await section.innerText()).includes("設定程式"));
      await section.screenshot({ path: join(output, `uninstall-${width}-${theme}.png`) });
      const connection = page.locator("[data-ui=hostConnection]");
      await connection.getByRole("status").first().getByText("已連線", { exact: true }).waitFor();
      await page.evaluate(() => {
        // New connections fail after uninstall; existing fixture ports keep replying.
        window.acceptance.hostRegistered = false;
      });
      await connection.getByRole("button", { name: "檢查連線", exact: true }).click();
      await connection.getByRole("status").first().getByText("尚未連線", { exact: true }).waitFor();
      assert.equal(await connection.getByText("Host 版本: 0.1.0", { exact: true }).count(), 0);
      assert.equal(await page.getByText("檢查完成，Host 已連線。", { exact: true }).count(), 0);
      await connection.screenshot({
        path: join(output, `uninstalled-status-${width}-${theme}.png`),
      });
      await page.evaluate(() => {
        window.acceptance.hostRegistered = true;
      });
      await connection.getByRole("button", { name: "檢查連線", exact: true }).click();
      await connection.getByRole("status").first().getByText("已連線", { exact: true }).waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "關閉", exact: true }).click();
      await page.evaluate(() => {
        window.acceptance.hostRegistered = false;
        window.acceptance.disconnectHost();
      });
      const failure = page.getByRole("status").filter({ hasText: "連線失敗，請重新連線。" });
      await failure.waitFor();
      await page.evaluate(() => {
        window.acceptance.hostRegistered = true;
      });
      await failure.getByRole("button", { name: "重試", exact: true }).click();
      await failure.waitFor({ state: "detached" });
      assert.equal(await page.getByText("連線失敗，請重新連線。", { exact: true }).count(), 0);
      await page.screenshot({ path: join(output, `retry-success-${width}-${theme}.png`) });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        "PASS compact UI, uninstall/reinstall and retry clears failure status",
        width,
        theme,
      );
    }
  console.log("Evidence:", output);
} finally {
  await browser?.close();
  await server.close();
}
