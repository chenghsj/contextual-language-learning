// Actual settings/request UI and storage; account and public catalogs are simulated.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-model-picker-ui-"));
console.log(JSON.stringify({ output }));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5194, strictPort: true, hmr: false, watch: null },
});
let browser;
const evidence = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(
        `http://127.0.0.1:5194/dev/redesign-preview.html?customModels=1&providers=1&theme=${theme}`,
      );
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      const connect = () =>
        page.evaluate(() =>
          window.acceptance.setPiProviders([
            { id: "openai", label: "OpenAI", connected: true, methods: ["api_key"] },
            { id: "antigravity", label: "Google Antigravity", connected: true, methods: ["oauth"] },
          ]),
        );
      await connect();
      const settings = page.locator('[data-slot="sheet-content"]');
      async function openSettings() {
        await page.locator("#header-settings").click();
        await settings.getByRole("button", { name: /^本機服務/ }).click();
        await settings.getByRole("button", { name: "檢查連線", exact: true }).click();
        await settings.getByRole("button", { name: "設定", exact: true }).click();
        await settings.getByRole("button", { name: /^AI 與模型/ }).click();
        await settings.getByRole("button", { name: "進階設定", exact: true }).waitFor();
      }
      const model = () => settings.locator("#settings-model");
      const advanced = () => settings.getByRole("button", { name: "進階設定", exact: true });
      const input = () => settings.getByLabel("模型 ID", { exact: true });
      const stored = () =>
        page.evaluate(
          async () => (await window.chrome.storage.local.get("preferencesV2")).preferencesV2,
        );
      async function service(label) {
        await settings.locator("#settings-service").click();
        await page.getByRole("combobox", { name: "搜尋服務…" }).fill(label);
        await page.getByRole("option", { name: label, exact: true }).click();
        await page.waitForFunction(() => !document.querySelector("#settings-model")?.disabled);
      }
      async function choose(query, label, trigger = model()) {
        await trigger.click();
        await page.getByRole("combobox", { name: "搜尋模型名稱…" }).fill(query);
        if (query === "GPT Future")
          await settings.screenshot({
            animations: "disabled",
            path: join(output, `search-${width}-${theme}.png`),
          });
        await page.getByRole("option", { name: label, exact: true }).click();
        await page.getByRole("combobox", { name: "搜尋模型名稱…" }).waitFor({ state: "hidden" });
      }
      await openSettings();
      await service("OpenAI");
      assert.equal(await input().count(), 0, "manual ID entry starts collapsed");
      await choose("GPT Future", "GPT Future Search");
      await page.waitForFunction(
        async () =>
          (await window.chrome.storage.local.get("preferencesV2")).preferencesV2.agent.modelId ===
          "gpt-future-search",
      );
      assert.equal((await stored()).agent.customModel, true);
      assert.deepEqual((await stored()).customModels.openai, ["gpt-future-search"]);
      await settings.screenshot({
        animations: "disabled",
        path: join(output, `search-selected-${width}-${theme}.png`),
      });
      await advanced().click();
      assert.equal(
        await settings.getByRole("link", { name: "查詢此服務的模型 ID" }).getAttribute("href"),
        "https://developers.openai.com/api/docs/models/all",
      );
      await input().fill("Invalid Model Name");
      await input().press("Enter");
      await settings.getByRole("alert").filter({ hasText: "不含空白" }).waitFor();
      await input().press("Escape");
      await input().waitFor({ state: "hidden" });
      assert.equal(await advanced().getAttribute("aria-expanded"), "false");
      const manual = "vendor/future-manual:latest";
      await advanced().click();
      await input().fill(manual);
      assert.equal((await input().boundingBox()).height, (await model().boundingBox()).height);
      await settings.screenshot({
        animations: "disabled",
        path: join(output, `advanced-${width}-${theme}.png`),
      });
      await input().press("Enter");
      await input().waitFor({ state: "hidden" });
      await page.waitForFunction(
        async () =>
          (await window.chrome.storage.local.get("preferencesV2")).preferencesV2.agent.modelId ===
          "vendor/future-manual:latest",
      );
      assert.deepEqual((await stored()).customModels.openai, ["gpt-future-search", manual]);
      await service("Google Antigravity");
      assert.equal(
        await advanced().getAttribute("aria-expanded"),
        "false",
        "changing services resets advanced settings",
      );
      await model().click();
      assert.equal(
        await page.getByRole("option", { name: "GPT Future Search", exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("option", { name: "Existing model (High)", exact: true }).count(),
        0,
      );
      await page.getByRole("combobox", { name: "搜尋模型名稱…" }).fill("Gemini Future");
      await page.getByRole("option", { name: "Gemini Future (High)", exact: true }).click();
      await page.getByRole("combobox", { name: "搜尋模型名稱…" }).waitFor({ state: "hidden" });
      await page.waitForFunction(
        async () =>
          (await window.chrome.storage.local.get("preferencesV2")).preferencesV2.agent.modelId ===
          "gemini-future-discovered-high",
      );
      assert.deepEqual((await stored()).customModels.antigravity, [
        "gemini-future-discovered-high",
      ]);
      await advanced().click();
      assert.equal(
        await settings.getByRole("link", { name: "查詢此服務的模型 ID" }).getAttribute("href"),
        "https://github.com/Rahularya01/pi-antigravity#models-and-routing",
      );
      await settings.getByRole("button", { name: "取消", exact: true }).click();
      await page.evaluate(() => {
        window.acceptance.failModelDiscovery = true;
      });
      await settings.getByRole("button", { name: "重新整理模型", exact: true }).click();
      await settings.getByRole("status").filter({ hasText: "無法更新清單" }).waitFor();
      await model().getByText("Gemini Future (High)", { exact: true }).waitFor();
      await page.evaluate(() => {
        window.acceptance.failModelDiscovery = false;
      });
      await settings.getByRole("button", { name: "重新整理模型", exact: true }).click();
      await settings
        .getByRole("status")
        .filter({ hasText: "無法更新清單" })
        .waitFor({ state: "hidden" });
      await page.reload();
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      await connect();
      await openSettings();
      await model().getByText("Gemini Future (High)", { exact: true }).waitFor();
      const picker = settings.locator('[data-ui="aiModelSelection"]');
      assert.ok(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      await settings.screenshot({
        animations: "disabled",
        path: join(output, `saved-${width}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      await page.getByRole("button", { name: "下一步", exact: true }).click();
      const request = page.locator("#request-model");
      await request.getByText("Gemini Future (High)", { exact: true }).waitFor();
      await choose("Fixture", "Fixture model", request);
      await request.getByText("Fixture model", { exact: true }).waitFor();
      await choose("第一個", "第一個可用模型", request);
      await request.getByText("第一個可用模型", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() =>
          window.acceptance.commands.some(
            request => request.type === "generate" || request.type === "generateCustom",
          ),
        ),
        false,
      );
      assert.deepEqual(errors, []);
      evidence.push({
        width,
        theme,
        nameSearch: true,
        serviceScoped: true,
        advancedCollapsed: true,
        lookupLinks: true,
        manualSaved: true,
        reload: true,
        requestSearch: true,
        automaticChoice: true,
      });
      await page.close();
    }
  await writeFile(join(output, "acceptance.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, evidence }));
} finally {
  await browser?.close();
  await server.close();
}
