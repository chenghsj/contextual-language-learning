// Actual offline SDK catalog and App UI; authentication is simulated, with no real credentials.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";
import { createPiRuntime, piProviders } from "../../local-host/src/agents/pi.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-provider-catalog-"));
const hostRoot = await mkdtemp(join(tmpdir(), "cll-provider-catalog-host-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5199, strictPort: true, hmr: false, watch: null },
});
let browser;
const evidence = [];
try {
  await writeFile(
    join(hostRoot, "auth.json"),
    JSON.stringify({
      openai: {
        type: "oauth",
        access: "synthetic",
        refresh: "synthetic",
        expires: Date.now() + 600000,
      },
      "github-copilot": {
        type: "oauth",
        access: "synthetic",
        refresh: "synthetic",
        expires: Date.now() + 600000,
      },
    }),
    { mode: 0o600 },
  );
  const runtime = await createPiRuntime(hostRoot);
  const catalog = await piProviders(runtime);
  assert.equal(catalog.length, 43);
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5199/dev/redesign-preview.html?providers=1`);
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.evaluate(providers => window.acceptance.setPiProviders(providers), catalog);
    await page.locator("#header-settings").click();
    const settings = page.locator('[data-slot="sheet-content"]');
    await settings.getByRole("button", { name: /^本機服務/ }).click();
    await settings.getByRole("button", { name: "檢查連線", exact: true }).click();
    await settings.getByRole("button", { name: "檢查連線", exact: true }).waitFor();
    await settings.getByRole("button", { name: "設定", exact: true }).click();
    await settings.getByRole("button", { name: /^AI 與模型/ }).click();
    const pi = page.locator('[data-ui="piSettings"]');
    const service = settings.locator("#settings-service");
    const openaiLabel = catalog.find(provider => provider.id === "openai").label;
    assert.equal(openaiLabel, "OpenAI (ChatGPT subscription)");
    assert.equal(await service.innerText(), openaiLabel);
    await pi
      .locator('[data-ui="pi-connected-services"]')
      .getByText(openaiLabel, { exact: true })
      .waitFor();
    await service.click();
    const serviceSearch = () => page.getByRole("combobox", { name: "搜尋服務…" });
    await serviceSearch().waitFor();
    assert.equal(await page.getByRole("option", { name: "選擇服務", exact: true }).count(), 0);
    await serviceSearch().fill("ChatGPT");
    assert.equal(await page.getByRole("option").filter({ visible: true }).count(), 1);
    await page.getByRole("option", { name: openaiLabel, exact: true }).waitFor();
    await serviceSearch().fill("no-matching-service");
    await page.getByText("找不到符合的服務。", { exact: true }).waitFor();
    await serviceSearch().fill("GitHub");
    await page.keyboard.press("Enter");
    await page.getByRole("option").first().waitFor({ state: "detached" });
    assert.equal(
      await service.innerText(),
      catalog.find(provider => provider.id === "github-copilot").label,
    );
    assert.equal(await service.evaluate(element => element === document.activeElement), true);
    await service.click();
    await serviceSearch().fill("ChatGPT");
    await page.keyboard.press("Enter");
    await page.getByRole("option").first().waitFor({ state: "detached" });
    assert.equal(await service.innerText(), openaiLabel);
    await pi.getByRole("button", { name: "新增 AI 連線", exact: true }).click();
    const expected = method =>
      catalog.filter(
        provider => provider.id !== "openai-codex" && provider.methods.includes(method),
      );
    const options = () => page.locator('[role="option"]');
    const wheelEvidence = [];
    async function checkWheelScroll(method) {
      const list = page.locator("[cmdk-list]");
      const sheetScroll = settings.locator('[data-ui="sheet-scroll"]');
      const outerTop = await sheetScroll.evaluate(element => element.scrollTop);
      const bounds = await list.boundingBox();
      const before = await list.evaluate(element => ({
        top: element.scrollTop,
        height: element.clientHeight,
        content: element.scrollHeight,
      }));
      assert.ok(before.content > before.height, "service list must overflow for this regression");
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 220);
      await page
        .waitForFunction(
          top => document.querySelector("[cmdk-list]")?.scrollTop > top,
          before.top,
          { timeout: 1500 },
        )
        .catch(() => undefined);
      const down = await list.evaluate(element => element.scrollTop);
      assert.ok(
        down > before.top,
        `Wheel must scroll ${method} down: ${JSON.stringify({ ...before, down })}`,
      );
      await page.mouse.wheel(0, -220);
      await page
        .waitForFunction(top => document.querySelector("[cmdk-list]")?.scrollTop < top, down, {
          timeout: 1500,
        })
        .catch(() => undefined);
      const up = await list.evaluate(element => element.scrollTop);
      assert.ok(up < down, `Wheel must scroll ${method} up: ${JSON.stringify({ down, up })}`);
      assert.equal(
        await sheetScroll.evaluate(element => element.scrollTop),
        outerTop,
        "popup scrolling must not move the settings page",
      );
      wheelEvidence.push({ method, ...before, down, up });
    }
    await pi.locator("#pi-connection-service").click();
    await options().first().waitFor();
    await checkWheelScroll("oauth");
    assert.deepEqual(
      await options().evaluateAll(items => items.map(item => item.getAttribute("data-value"))),
      expected("oauth").map(provider => provider.id),
    );
    for (const provider of expected("oauth")) {
      assert.ok(
        (await page.locator(`[role="option"][data-value="${provider.id}"]`).innerText()).includes(
          provider.methodLabels.oauth,
        ),
      );
    }
    await page.getByRole("combobox", { name: "搜尋服務…" }).fill("Claude");
    assert.equal(await options().filter({ visible: true }).count(), 1);
    assert.equal(
      await options().filter({ visible: true }).first().innerText(),
      "Anthropic (Claude Pro/Max)",
    );
    await page.screenshot({ path: join(output, `oauth-search-${width}.png`) });
    await page.keyboard.press("Escape");
    await options().first().waitFor({ state: "detached" });
    await pi.getByRole("tab", { name: "API Key", exact: true }).click();
    await pi.locator("#pi-connection-service").click();
    await options().first().waitFor();
    await checkWheelScroll("api_key");
    assert.deepEqual(
      await options().evaluateAll(items => items.map(item => item.getAttribute("data-value"))),
      expected("api_key").map(provider => provider.id),
    );
    for (const provider of expected("api_key")) {
      assert.ok(
        (await page.locator(`[role="option"][data-value="${provider.id}"]`).innerText()).includes(
          provider.methodLabels.api_key,
        ),
      );
    }
    const catalogOverflow = await settings.evaluate(element => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    assert.ok(
      catalogOverflow.scroll <= catalogOverflow.client + 1,
      JSON.stringify(catalogOverflow),
    );
    const popupBounds = await page
      .locator("[data-radix-popper-content-wrapper]")
      .evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    assert.ok(popupBounds.left >= 0 && popupBounds.right <= width, JSON.stringify(popupBounds));
    await page.screenshot({ path: join(output, `services-${width}.png`) });
    const search = page.getByRole("combobox", { name: "搜尋服務…" });
    await search.fill("DeepSeek");
    const deepseek = page.getByRole("option", {
      name: catalog.find(provider => provider.id === "deepseek").methodLabels.api_key,
      exact: true,
    });
    await deepseek.waitFor();
    assert.equal(await options().filter({ visible: true }).count(), 1);
    await page.keyboard.press("Enter");
    await options().first().waitFor({ state: "detached" });
    assert.equal(
      await pi.locator("#pi-connection-service").innerText(),
      catalog.find(provider => provider.id === "deepseek").methodLabels.api_key,
    );
    assert.equal(await options().count(), 0, "selection closes the popup");
    assert.equal(
      await pi
        .locator("#pi-connection-service")
        .evaluate(element => element === document.activeElement),
      true,
    );
    await pi.locator("#pi-connection-service").click();
    await page.getByRole("combobox", { name: "搜尋服務…" }).waitFor();
    await page.keyboard.press("Escape");
    await options().first().waitFor({ state: "detached" });
    assert.equal(await options().count(), 0);
    assert.equal(await settings.isVisible(), true, "Escape closes only the popup");
    await pi.getByRole("button", { name: "API Key", exact: true }).click();
    const input = pi.locator('[data-ui="piAuth"] input');
    await input.waitFor();
    assert.equal(await input.getAttribute("type"), "password");
    const login = await page.evaluate(() =>
      window.acceptance.commands.filter(command => command.type === "piLogin").at(-1),
    );
    assert.equal(login.provider, "deepseek");
    assert.equal(login.method, "api_key");
    await page.evaluate(() => window.acceptance.finishPiLogin("deepseek"));
    const connected = pi.locator('[data-ui="pi-connected-services"]');
    await connected.getByText("DeepSeek", { exact: true }).waitFor();
    assert.equal(await settings.locator("#settings-service").innerText(), openaiLabel);
    await page.evaluate(() => {
      window.acceptance.agentModels = [
        { id: "fixture-model", label: "Available model" },
        { id: "denied", label: "Unavailable model", disabled: true },
        { id: "other", label: "Other available model" },
      ];
    });
    await settings.getByRole("button", { name: "重新整理模型", exact: true }).click();
    const modelPicker = settings.locator("#settings-model");
    await modelPicker.waitFor();
    await modelPicker.click();
    const deniedModel = page.getByRole("option", {
      name: "Unavailable model",
      exact: true,
    });
    await deniedModel.waitFor();
    assert.equal(await deniedModel.getAttribute("aria-disabled"), "true");
    await page.getByRole("option", { name: "Available model", exact: true }).click();
    await modelPicker.click();
    await page.getByRole("option", { name: "Available model", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(
      () => document.activeElement?.textContent === "Other available model",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await modelPicker.innerText(),
      "Other available model",
      "keyboard skips disabled models",
    );
    await page.evaluate(() => {
      window.acceptance.agentModels = window.acceptance.agentModels.map(model => ({
        ...model,
        disabled: true,
      }));
    });
    await settings.getByRole("button", { name: "重新整理模型", exact: true }).click();
    await settings.getByText("已存的模型目前不可用，請重新選擇。", { exact: true }).waitFor();
    await modelPicker.click();
    assert.equal(await page.getByRole("option").count(), 4);
    for (const option of await page.getByRole("option").all()) {
      assert.equal(await option.getAttribute("aria-disabled"), "true");
    }
    await page.screenshot({ path: join(output, `disabled-models-${width}.png`) });
    await page.keyboard.press("Escape");
    await settings.screenshot({ path: join(output, `catalog-${width}.png`) });
    const overflow = await settings.evaluate(element => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
    assert.deepEqual(errors, []);
    evidence.push({
      width,
      services: catalog.length,
      oauth: expected("oauth").length,
      apiKey: expected("api_key").length,
      catalogOverflow,
      popupBounds,
      wheelEvidence,
      overflow,
      errors,
    });
    await page.close();
  }
  await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, evidence }, null, 2));
} catch (error) {
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  }
  console.log("Evidence:", output);
  throw error;
} finally {
  await browser?.close();
  await server.close();
  await rm(hostRoot, { recursive: true, force: true });
}
