import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { translate } from "../src/i18n/messages.ts";
import { libraryNoticeCopy } from "../src/i18n/library-notice.ts";

// Real library/App UI, synthetic lessons and simulated Google authorization.
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const cases = [
    ...[320, 550].flatMap(width =>
      ["light", "dark"].map(theme => ({ width, theme, locale: "zh-TW" })),
    ),
    ...["en", "zh-CN", "ja", "ko"].map(locale => ({ width: 320, theme: "light", locale })),
  ];
  for (const { width, theme, locale } of cases) {
    const page = await browser.newPage({
      viewport: { width, height: 850 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(
      server.resolvedUrls.local[0] +
        `dev/library-preview.html?error=auth&theme=${theme}&locale=${locale}`,
    );
    const ui = libraryNoticeCopy(locale),
      notice = page.locator('[data-ui="library-error"]');
    await notice.waitFor();
    assert.equal(await notice.locator("h3").textContent(), ui.authTitle);
    assert.equal(await notice.locator("pre").count(), 0, "diagnostics start collapsed");
    assert.match(
      await notice.locator('[data-ui="library-error-account"]').textContent(),
      /language.learning.secondary.account.with.a.long.name@example.test/,
    );
    const box = await notice.boundingBox(),
      heading = await page.locator("#library-heading").boundingBox(),
      search = await page.locator("#lesson-search").boundingBox();
    assert.ok(
      box.y >= heading.y + heading.height && box.y + box.height <= search.y,
      "notice belongs above search and filters",
    );
    await notice.getByRole("button", { name: ui.details, exact: true }).click();
    assert.match(await notice.locator("pre").textContent(), /invalid_grant/);
    assert.equal(
      await notice.evaluate(element => element.scrollWidth <= element.clientWidth),
      true,
    );
    await notice.getByRole("button", { name: ui.hideDetails, exact: true }).click();
    await notice
      .locator("button")
      .first()
      .evaluate(button => {
        button.click();
        button.click();
      });
    assert.equal(
      await page.evaluate(() => window.acceptance.reconnected),
      1,
      "connection attempts are deduplicated",
    );
    await notice.getByRole("button", { name: ui.reconnectAccount, exact: true }).waitFor();
    const reconnect = notice.getByRole("button", { name: ui.reconnectAccount, exact: true });
    await page.waitForFunction(
      label =>
        [...document.querySelectorAll('[data-ui="library-error"] button')].some(
          button => button.textContent === label && !button.disabled,
        ),
      ui.reconnectAccount,
    );
    assert.equal(
      await page.evaluate(() => window.acceptance.refreshed),
      0,
      "expired grants do not just retry catalog loading",
    );
    assert.equal(await reconnect.isEnabled(), true);
    const local = page.locator('[data-ui="library-entry"]').filter({ hasText: "正義使者" });
    await local.getByRole("button", { name: translate(locale, "openLesson"), exact: true }).click();
    assert.ok(
      (await page.evaluate(() => window.acceptance.opened)).length > 0,
      "local lessons remain usable",
    );
    await notice.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: `/tmp/library-error-${width}-${theme}-${locale}.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS auth notice ${width} ${theme} ${locale}`);
    await page.close();
  }
  for (const kind of ["generic", "reconnect-failure"]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 850 } });
    const ui = libraryNoticeCopy("zh-TW");
    await page.goto(
      server.resolvedUrls.local[0] +
        "dev/library-preview.html?error=" +
        (kind === "generic" ? "generic" : "auth&reconnect=fail"),
    );
    const notice = page.locator('[data-ui="library-error"]');
    await notice.waitFor();
    if (kind === "generic") {
      assert.equal(await notice.locator("h3").textContent(), ui.title);
      await notice.getByRole("button", { name: ui.retry, exact: true }).click();
      assert.equal(await page.evaluate(() => window.acceptance.refreshed), 1);
      assert.equal(await page.evaluate(() => window.acceptance.reconnected), 0);
      await notice.getByRole("button", { name: ui.details, exact: true }).click();
      assert.equal(
        await notice.locator("pre").evaluate(element => element.scrollWidth <= element.clientWidth),
        true,
        "long diagnostics wrap",
      );
    } else {
      await notice.getByRole("button", { name: ui.reconnectAccount, exact: true }).click();
      await notice.getByText(ui.reconnectFailed, { exact: true }).waitFor();
      assert.equal(await notice.locator("pre").count(), 0);
      await notice.getByRole("button", { name: ui.details, exact: true }).click();
      assert.match(await notice.locator("pre").textContent(), /Simulated reconnect failure/);
    }
    console.log("PASS " + kind);
    await page.close();
  }
  for (const explicitSelection of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 480, height: 850 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/dev/redesign-preview.tsx", async route => {
      const response = await route.fetch();
      const body = (await response.text())
        .replace(
          "const saved =",
          explicitSelection
            ? 'preferences.backup = {enabled:false,accountId:"drive-preview"};\nconst saved ='
            : "const saved =",
        )
        .replace(
          "accounts: drivePreview ? previewAccounts : []",
          explicitSelection
            ? 'accounts: drivePreview ? [{id:"drive-healthy",email:"healthy@example.test"},previewAccount] : []'
            : 'accounts: drivePreview ? [previewAccount,{id:"drive-healthy",email:"healthy@example.test"}] : []',
        )
        .replace(
          '      default:\n        reply({ type: "error"',
          `      case "listDriveLessons":
        reply(window.libraryDriveConnected ? {type:"driveLessons",lessons:[]} : {type:"error",message:"Google OAuth HTTP 400 invalid_grant"});break;
      case "listCustomDriveDocuments": reply({type:"customDriveDocuments",documents:[]});break;
      case "driveConnect": { const wrong=window.libraryConnectWrong!==false;window.libraryDriveConnected=!wrong;reply({type:"driveConnected",account:wrong?{id:"drive-healthy",email:"healthy@example.test"}:previewAccount});break; }
      default:\n        reply({ type: "error"`,
        );
      await route.fulfill({ response, body });
    });
    await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?drive=1");
    await page.locator("#page-nav-lessons").click();
    const notice = page.locator('[data-ui="library-error"]');
    await notice.waitFor();
    const before = await page.evaluate(
      async () => (await chrome.storage.local.get("preferencesV2")).preferencesV2.backup,
    );
    assert.ok(
      (await notice.textContent()).includes("learner@example.test"),
      "failed account email is visible without expanding details",
    );
    const reconnect = notice.getByRole("button", { name: "重新連線此帳號", exact: true });
    const countLoads = () =>
      page.evaluate(
        () =>
          window.acceptance.commands.filter(command => command.type === "listDriveLessons").length,
      );
    const loadsBefore = await countLoads();
    await reconnect.click();
    await notice.getByRole("status").waitFor();
    assert.match(await notice.getByRole("status").textContent(), /healthy@example\.test/);
    assert.match(await notice.getByRole("status").textContent(), /learner@example\.test/);
    assert.equal(
      await countLoads(),
      loadsBefore,
      "wrong account must not refresh or clear the failed account",
    );
    assert.deepEqual(
      await page.evaluate(
        async () => (await chrome.storage.local.get("preferencesV2")).preferencesV2.backup,
      ),
      before,
    );
    assert.equal(
      await notice.locator("pre").count(),
      0,
      "wrong account guidance is not hidden in diagnostics",
    );
    await page.screenshot({ path: `/tmp/library-account-mismatch-${explicitSelection}.png` });
    const wrongCommands = await page.evaluate(() => window.acceptance.commands);
    const wrongConnect = wrongCommands.findIndex(command => command.type === "driveConnect");
    assert.equal(
      wrongCommands
        .slice(wrongConnect + 1)
        .some(command => command.type === "driveValidate" && command.accountId !== "drive-preview"),
      false,
      "a different account is not accepted as recovery",
    );
    await page.evaluate(() => {
      window.libraryConnectWrong = false;
    });
    await reconnect.click();
    await notice.waitFor({ state: "hidden" });
    const after = await page.evaluate(
      async () => (await chrome.storage.local.get("preferencesV2")).preferencesV2.backup,
    );
    assert.deepEqual(after, before, "library reconnection preserves backup preferences");
    const commands = await page.evaluate(() =>
      window.acceptance.commands.map(command => command.type),
    );
    const connected = commands.lastIndexOf("driveConnect");
    assert.ok(
      connected >= 0 &&
        commands.slice(connected + 1).includes("driveValidate") &&
        commands.slice(connected + 1).includes("listDriveLessons"),
      "reconnect validates Drive and refreshes the library",
    );
    assert.ok(await page.locator('[data-ui="library-entry"]').count());
    await page.getByRole("button", { name: "重新整理", exact: true }).click();
    await page.waitForFunction(
      previous =>
        window.acceptance.commands.filter(command => command.type === "listDriveLessons").length >
        previous,
      loadsBefore + 1,
    );
    const refreshedAccounts = await page.evaluate(() =>
      window.acceptance.commands
        .filter(command => command.type === "listDriveLessons")
        .map(command => command.accountId),
    );
    assert.ok(
      refreshedAccounts.every(id => id === "drive-preview"),
      "reconnecting preserves account order and the library account on later refreshes",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS App account mismatch, targeted recovery, and preserve backup preferences: " +
        (explicitSelection ? "selected account" : "default account"),
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
