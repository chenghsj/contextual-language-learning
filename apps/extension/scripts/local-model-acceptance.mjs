// Real settings UI and worker, simulated Native Host; no installed models or secrets needed.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-local-model-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5199, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const [width, theme] of [
    [320, "light"],
    [480, "dark"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5199/dev/redesign-preview.html?providers=1&theme=${theme}`);
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.locator("#header-settings").click();
    const settings = page.locator('[data-slot="sheet-content"]');
    await settings.getByRole("button", { name: /^AI 與模型/ }).click();
    const pi = page.locator('[data-ui="piSettings"]');
    await pi.getByRole("button", { name: "新增 AI 連線", exact: true }).click();
    await pi.getByRole("tab", { name: "本地／自訂", exact: true }).click();
    const form = pi.locator('[data-ui="local-model-settings"]');
    const address = form.locator("#local-model-address");
    await address.fill("http://offline.invalid/v1");
    await form.getByRole("button", { name: "測試連線", exact: true }).click();
    await form
      .getByRole("alert")
      .getByText(/無法連線/)
      .waitFor();
    await address.fill("http://localhost:1234/v1");
    await form.getByRole("button", { name: "測試連線", exact: true }).click();
    await form
      .getByRole("status")
      .getByText(/連線成功/)
      .waitFor();
    assert.equal(await form.locator("#local-model-id").inputValue(), "local-fixture");
    await form.locator("#local-model-key").fill("synthetic-ui-key");
    await form.locator("summary").click();
    await form.locator("#local-model-contextWindow").fill("16384");
    await form.locator("#local-model-maxTokens").fill("4096");
    await form.getByRole("button", { name: "儲存並使用", exact: true }).click();
    const connected = pi.locator('[data-ui="pi-connected-services"]');
    await connected.getByText("本地／自訂", { exact: true }).waitFor();
    await page.waitForFunction(() =>
      window.acceptance.commands.some(
        command => command.type === "agentModels" && command.settings.provider === "local",
      ),
    );
    const saved = await page.evaluate(() =>
      window.acceptance.commands.find(command => command.type === "setLocalModelConfig"),
    );
    assert.deepEqual(saved.config, {
      baseUrl: "http://localhost:1234/v1",
      modelId: "local-fixture",
      contextWindow: 16384,
      maxTokens: 4096,
      reasoning: false,
    });
    assert.equal(saved.apiKey, "synthetic-ui-key");
    assert.equal(await form.locator("#local-model-key").inputValue(), "");
    // Remount the form and verify only non-secret settings return to the UI.
    await pi.getByRole("tab", { name: "帳號登入", exact: true }).click();
    await connected.getByRole("button", { name: /^本地／自訂/ }).click();
    await connected.getByRole("button", { name: "編輯連線", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("#local-model-key")?.getAttribute("placeholder")?.includes("已儲存"),
    );
    assert.equal(await address.inputValue(), "http://localhost:1234/v1");
    assert.equal(await form.locator("#local-model-key").inputValue(), "");
    await form.locator("#local-model-id").fill("local-second");
    await form.getByRole("button", { name: "儲存並使用", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.acceptance.commands.filter(command => command.type === "setLocalModelConfig")
          .length === 2,
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-ui="aiModelSelection"]')].some(element =>
        element.textContent.includes("local-second"),
      ),
    );
    assert.equal(
      await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
      true,
      `${width}: no horizontal overflow`,
    );
    await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"));
    await settings.screenshot({ path: join(output, `local-model-${width}-${theme}.png`) });
    await connected.getByRole("button", { name: "移除連線", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "移除連線", exact: true })
      .click();
    await connected.getByText("本地／自訂", { exact: true }).waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelector("#local-model-id")?.value === "");
    assert.equal(await address.inputValue(), "http://localhost:11434/v1");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    JSON.stringify({ passed: true, viewports: [320, 480], themes: ["light", "dark"], output }),
  );
} finally {
  await browser?.close();
  await server.close();
}
