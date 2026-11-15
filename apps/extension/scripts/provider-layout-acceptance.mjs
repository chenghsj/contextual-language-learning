// Real App and worker with simulated Host authentication; no real credentials or requests.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-provider-layout-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false, watch: null },
});
let browser;
const evidence = [];

async function placeNearBottom(button) {
  await button.evaluate(element => {
    const scroll = element.closest('[data-ui="sheet-scroll"]');
    scroll.scrollTop +=
      element.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom + 12;
  });
}

async function waitInsideSettings(locator) {
  await locator.page().waitForFunction(
    element => {
      const bounds = element.getBoundingClientRect();
      const viewport = element.closest('[data-ui="sheet-scroll"]').getBoundingClientRect();
      return bounds.height > 0 && bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
    },
    await locator.elementHandle(),
  );
}

try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480]) {
    const height = width === 320 ? 560 : 800;
    const motion = width === 320 ? "full" : "reduced";
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:5198/dev/redesign-preview.html?providers=1&motion=${motion}&theme=${width === 320 ? "light" : "dark"}`,
    );
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.locator("#header-settings").click();
    const settings = page.locator('[data-slot="sheet-content"]');
    await settings.getByRole("button", { name: /^AI 與模型/ }).click();
    const pi = page.locator('[data-ui="piSettings"]');
    const add = pi.getByRole("button", { name: "新增 AI 連線", exact: true });
    await pi
      .locator('[data-ui="pi-connected-services"]')
      .getByText("Google", { exact: true })
      .waitFor();
    assert.equal(await add.getAttribute("aria-expanded"), "false");
    assert.equal(await pi.getByRole("tablist").count(), 0);
    await settings.screenshot({ path: join(output, `connected-${width}.png`) });
    const connected = pi.locator('[data-ui="pi-connected-services"]');
    const openai = connected.getByRole("button", { name: /^OpenAI/ });
    const google = connected.getByRole("button", { name: /^Google/ });
    await openai.getByText("帳號登入 · 使用中", { exact: true }).waitFor();
    await google.getByText("API Key", { exact: true }).waitFor();
    await placeNearBottom(openai);
    await openai.click();
    await waitInsideSettings(connected.getByRole("button", { name: "登出", exact: true }));
    await google.click();
    assert.equal(await openai.getAttribute("aria-expanded"), "false");
    assert.equal(await google.getAttribute("aria-expanded"), "true");
    await google.focus();
    await page.keyboard.press("Home");
    assert.equal(await openai.evaluate(element => element === document.activeElement), true);
    await google.click();
    await placeNearBottom(add);
    await add.evaluate(element => element.focus({ preventScroll: true }));
    await page.keyboard.press("Enter");
    await waitInsideSettings(pi.locator("#pi-connection-service"));
    assert.equal(await add.evaluate(element => element === document.activeElement), true);
    await pi.locator("#pi-connection-service").click();
    await page.getByPlaceholder("搜尋服務…").fill("Anthropic");
    assert.equal(await page.getByRole("option").count(), 1);
    await page.keyboard.press("Enter");
    await pi.getByRole("button", { name: "登入帳號", exact: true }).click();
    await pi
      .locator('[data-ui="piAuth"]')
      .getByText(/請開啟登入網頁/)
      .waitFor();
    await add.click();
    await pi.getByText("授權進行中 · Anthropic", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.acceptance.commands.filter(command => command.type === "piAuthCancel").length,
      ),
      0,
    );
    await pi.getByRole("button", { name: "返回授權", exact: true }).click();
    await pi.getByRole("tab", { name: "API Key", exact: true }).click();
    await pi.getByRole("button", { name: "返回授權", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => window.acceptance.commands.filter(command => command.type === "piLogin").length,
      ),
      1,
    );
    await settings.screenshot({ path: join(output, `oauth-${width}.png`) });
    await pi.getByRole("button", { name: "取消", exact: true }).click();
    await pi.getByRole("tab", { name: "API Key", exact: true }).click();
    await pi.locator("#pi-connection-service").click();
    await page.getByRole("option", { name: "Anthropic", exact: true }).click();
    await page.getByPlaceholder("搜尋服務…").waitFor({ state: "detached" });
    const startKey = pi.getByRole("button", { name: "API Key", exact: true });
    await placeNearBottom(startKey);
    await startKey.click();
    const input = pi.locator('[data-ui="piAuth"] input');
    await waitInsideSettings(input);
    await waitInsideSettings(pi.getByRole("button", { name: "儲存 API Key", exact: true }));
    await waitInsideSettings(pi.getByRole("button", { name: "取消", exact: true }));
    await settings.screenshot({ path: join(output, `api-key-${width}.png`) });
    await input.fill("test-only-draft");
    assert.equal(await input.getAttribute("type"), "password");
    await pi.getByRole("button", { name: "顯示 API Key", exact: true }).click();
    assert.equal(await input.getAttribute("type"), "text");
    await add.click();
    await add.click();
    assert.equal(await input.count(), 0);
    await pi.getByRole("button", { name: "API Key", exact: true }).click();
    assert.equal(await input.inputValue(), "");
    await input.fill("test-only-key");
    await pi.getByRole("button", { name: "儲存 API Key", exact: true }).click();
    await connected.getByText("Anthropic", { exact: true }).waitFor();
    await connected
      .getByRole("button", { name: /^Anthropic/ })
      .getByText("API Key", { exact: true })
      .waitFor();
    assert.equal(await settings.locator("#settings-service").innerText(), "OpenAI");
    assert.equal(await input.count(), 0);
    await settings.screenshot({ path: join(output, `saved-${width}.png`) });
    await connected.getByRole("button", { name: /^Anthropic/ }).click();
    await connected.getByRole("button", { name: "登出", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await confirmation.waitFor();
    await confirmation.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "detached" });
    assert.equal(await settings.isVisible(), true, "closing confirmation keeps settings open");
    assert.equal(
      await page.evaluate(
        () => window.acceptance.commands.filter(command => command.type === "piLogout").length,
      ),
      0,
    );
    await connected.getByRole("button", { name: "登出", exact: true }).click();
    await confirmation.getByRole("button", { name: "登出", exact: true }).click();
    await connected.getByText("Anthropic", { exact: true }).waitFor({ state: "detached" });
    await pi.getByRole("tab", { name: "帳號登入", exact: true }).click();
    await pi.locator("#pi-connection-service").click();
    await page.getByRole("option", { name: "GitHub Copilot", exact: true }).click();
    await pi.getByRole("button", { name: "登入帳號", exact: true }).click();
    const domain = pi.locator('[data-ui="piAuth"] input');
    await domain.waitFor();
    assert.equal(await domain.getAttribute("placeholder"), "github.com");
    assert.equal(
      await pi.getByRole("button", { name: "使用 github.com 繼續", exact: true }).isEnabled(),
      true,
    );
    await settings.screenshot({ path: join(output, `copilot-domain-${width}.png`) });
    await pi.getByRole("button", { name: "使用 github.com 繼續", exact: true }).click();
    await pi.locator('[data-ui="piAuth"] code').getByText("ABCD-1234", { exact: true }).waitFor();
    const blankAnswer = await page.evaluate(() =>
      window.acceptance.commands.filter(command => command.type === "piAuthAnswer").at(-1),
    );
    assert.equal(blankAnswer.value, "");
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5198" });
    await pi.getByRole("button", { name: "複製驗證碼", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "ABCD-1234");
    await pi.getByRole("button", { name: "開啟登入網頁", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.acceptance.openedUrls.at(-1)),
      "https://github.com/login/device",
    );
    await settings.screenshot({ path: join(output, `copilot-device-${width}.png`) });
    await page.evaluate(() => window.acceptance.finishPiLogin("github-copilot"));
    await connected.getByText("GitHub Copilot", { exact: true }).waitFor();
    await connected
      .getByRole("button", { name: /^GitHub Copilot/ })
      .getByText("帳號登入", { exact: true })
      .waitFor();
    assert.equal(await settings.locator("#settings-service").innerText(), "OpenAI");
    assert.equal(await pi.locator('[data-ui="piAuth"] code').count(), 0);
    const overflow = await settings.evaluate(element => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
      nestedButtons: element.querySelectorAll("button button").length,
    }));
    assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify(overflow));
    assert.equal(overflow.nestedButtons, 0);
    assert.deepEqual(errors, []);
    evidence.push({
      width,
      height,
      motion,
      errors,
      overflow,
      defaultPreserved: true,
      oauthPreserved: true,
      secretCleared: true,
      logoutConfirmed: true,
      copilotBlankDomainAccepted: true,
      copilotDeviceCodeCopied: true,
    });
    await page.close();
  }
  await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, evidence }, null, 2));
} catch (error) {
  for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
    console.log(await page.locator("body").innerText());
  }
  console.log("Evidence:", output);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
