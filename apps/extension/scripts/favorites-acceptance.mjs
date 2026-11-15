import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-favorites-acceptance-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
async function confirmRemoval(page) {
  const dialog = page.getByRole("dialog", { name: "取消收藏？", exact: true });
  await dialog.getByRole("button", { name: "取消收藏", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    "page has no horizontal overflow",
  );
  const overflow = await page
    .locator('[data-ui="favorites-library"], [data-ui="reader-header"]')
    .evaluateAll(elements =>
      elements
        .filter(element => element.scrollWidth > element.clientWidth + 1)
        .map(element => element.dataset.ui),
    );
  assert.deepEqual(overflow, [], "favorite controls fit their containers");
}
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const width of [320, 480, 548])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 850 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(
        server.resolvedUrls.local[0] +
          `dev/redesign-preview.html?favorites=1&theme=${theme}&favoriteBackupAccount=drive-second`,
      );
      await page.locator("#page-nav-lessons").click();
      await page.getByRole("tab", { name: "收藏", exact: true }).click();
      await page.getByText("還沒有收藏。", { exact: false }).waitFor();
      await page.getByRole("tab", { name: "所有內容", exact: true }).click();
      await page
        .locator("article")
        .filter({ hasText: "An original video" })
        .getByRole("button")
        .click();
      const save = page.getByRole("button", { name: "收藏此情境", exact: true });
      await save.waitFor();
      await save.click();
      const remove = page.getByRole("button", { name: "取消收藏此情境", exact: true });
      await remove.waitFor();
      assert.equal(await remove.getAttribute("aria-pressed"), "true");
      const selectedScene = await page.evaluate(
        () =>
          window.acceptance.commands.find(command => command.type === "setFavorite").input.sceneId,
      );
      assert.notEqual(
        selectedScene,
        "00000000-0000-4000-8000-000000000099",
        "favorite captures the restored second scene",
      );
      await page.evaluate(() => {
        window.acceptance.failNextFavorite = true;
      });
      const mutationsBeforePopup = await page.evaluate(
        () => window.acceptance.commands.filter(command => command.type === "setFavorite").length,
      );
      await remove.click();
      const confirmation = page.getByRole("dialog", {
        name: "取消收藏？",
        exact: true,
      });
      await confirmation.waitFor();
      const triggerBounds = await remove.boundingBox();
      const popoverBounds = await confirmation.boundingBox();
      assert.ok(triggerBounds && popoverBounds);
      assert.ok(popoverBounds.width <= 240, "removal confirmation is a compact popover");
      assert.ok(popoverBounds.height <= 100, "confirmation fits a short question and two actions");
      assert.ok(
        Math.min(
          Math.abs(popoverBounds.y - triggerBounds.y - triggerBounds.height),
          Math.abs(popoverBounds.y + popoverBounds.height - triggerBounds.y),
        ) < 24,
        "confirmation is anchored beside its favorite button",
      );
      assert.equal(
        await page.evaluate(
          () => window.acceptance.commands.filter(command => command.type === "setFavorite").length,
        ),
        mutationsBeforePopup,
        "opening confirmation does not mutate favorites",
      );
      await page.screenshot({
        path: join(output, `favorite-remove-confirmation-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await confirmation.getByRole("button", { name: "保留", exact: true }).click();
      await confirmation.waitFor({ state: "hidden" });
      assert.equal(
        await remove.evaluate(element => document.activeElement === element),
        true,
        "keeping a favorite restores focus to its button",
      );
      assert.equal(
        await page.evaluate(
          () => window.acceptance.commands.filter(command => command.type === "setFavorite").length,
        ),
        mutationsBeforePopup,
        "keeping a favorite does not send a removal",
      );
      await remove.click();
      await confirmation.waitFor();
      await page.locator('[data-ui="reader-header"]').click({ position: { x: 2, y: 2 } });
      await confirmation.waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(
          () => window.acceptance.commands.filter(command => command.type === "setFavorite").length,
        ),
        mutationsBeforePopup,
        "clicking outside the popover preserves the favorite",
      );
      await remove.click();
      await confirmRemoval(page);
      await page.getByText("無法更新收藏，請再試一次。", { exact: true }).waitFor();
      assert.equal(
        await remove.getAttribute("aria-pressed"),
        "true",
        "failed remove retains confirmed membership",
      );
      await remove.click();
      await confirmRemoval(page);
      await save.waitFor();
      const retryIds = await page.evaluate(() =>
        window.acceptance.commands
          .filter(command => command.type === "setFavorite" && !command.input.desired)
          .map(command => command.input.mutationId),
      );
      assert.equal(retryIds[0], retryIds[1], "retry preserves mutation identity");
      await save.click();
      await remove.waitFor();
      await page.locator('[data-ui="reader-header"]').getByRole("button").first().click();
      await page.getByRole("tab", { name: "收藏", exact: true }).click();
      const library = page.locator('[data-ui="favorites-library"]');
      await library.locator("li").waitFor();
      const searchBounds = await library.getByRole("searchbox").boundingBox();
      const languageBounds = await library
        .getByRole("combobox", { name: "語言", exact: true })
        .boundingBox();
      assert.ok(searchBounds && languageBounds);
      assert.equal(searchBounds.y, languageBounds.y, "search and language filters share one row");
      assert.equal(
        await library
          .getByRole("switch", { name: "Google Drive 同步", exact: true })
          .getAttribute("aria-checked"),
        "false",
      );
      assert.equal(
        await library.getByRole("combobox", { name: "收藏集合" }).count(),
        0,
        "the main library has no collection selector",
      );
      assert.equal(
        await page.getByRole("tab", { name: "收藏", exact: true }).getAttribute("aria-selected"),
        "true",
      );
      const toasts = page.locator("[data-sonner-toast] [data-close-button]");
      if (await toasts.count()) await toasts.first().click();
      await library
        .locator("li")
        .first()
        .getByRole("button", { name: /取消收藏此情境/ })
        .click();
      await confirmation.waitFor();
      const mutationsBeforeEscape = await page.evaluate(
        () => window.acceptance.commands.filter(command => command.type === "setFavorite").length,
      );
      await page.screenshot({
        path: join(output, `favorite-list-remove-popover-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await confirmation.waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(
          () => window.acceptance.commands.filter(command => command.type === "setFavorite").length,
        ),
        mutationsBeforeEscape,
        "Escape preserves the favorite without a Host mutation",
      );
      assert.equal(await library.locator("li").count(), 1);
      await noOverflow(page);
      await page.screenshot({
        path: join(output, `favorites-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await library.getByRole("searchbox").fill("no-such-scene");
      await library.getByText("沒有符合篩選條件的收藏。", { exact: true }).waitFor();
      await library.getByRole("searchbox").fill("");
      await library.locator("li").waitFor();
      await library.getByRole("combobox", { name: "語言", exact: true }).click();
      await page.getByRole("option", { name: "日語", exact: true }).click();
      await library.getByText("沒有符合篩選條件的收藏。", { exact: true }).waitFor();
      await library.getByRole("combobox", { name: "語言", exact: true }).click();
      await page.getByRole("option", { name: "所有語言", exact: true }).click();
      await library.locator("li").waitFor();
      const originalProgress = await page.evaluate(
        async () =>
          (
            await chrome.storage.local.get("contextualStudyV5:00000000-0000-4000-8000-000000000001")
          )["contextualStudyV5:00000000-0000-4000-8000-000000000001"],
      );
      const documentCalls = await page.evaluate(
        () => window.acceptance.commands.filter(command => command.type === "getDocument").length,
      );
      await page.evaluate(() => {
        window.acceptance.favoriteSourceDeleted = true;
      });
      await library.locator("li").first().getByRole("button").first().click();
      await page.getByText("收藏情境 · 播放時間僅供讀取", { exact: true }).waitFor();
      await page.locator('[data-ui="sourceSentence"]').first().waitFor();
      const readerHeader = page.locator('[data-ui="reader-header"]');
      assert.match(await readerHeader.getByRole("combobox").innerText(), /1\s*\/\s*1/u);
      assert.equal(
        await readerHeader.getByRole("button", { name: "上一場景", exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await readerHeader.getByRole("button", { name: "下一場景", exact: true }).isDisabled(),
        true,
      );
      const options = page.locator("#reader-options");
      if (await options.isVisible()) {
        await options.click();
        assert.equal(
          await page.getByRole("button", { name: /調整.*時間|恢復.*時間/ }).count(),
          0,
          "readonly favorites have no timing mutations",
        );
        await page.keyboard.press("Escape");
      }
      await noOverflow(page);
      await page.screenshot({
        path: join(output, `favorite-reader-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      assert.equal(
        await page.evaluate(
          () => window.acceptance.commands.filter(command => command.type === "getDocument").length,
        ),
        documentCalls,
        "favorite opens without the deleted source lesson",
      );
      assert.deepEqual(
        await page.evaluate(
          async () =>
            (
              await chrome.storage.local.get(
                "contextualStudyV5:00000000-0000-4000-8000-000000000001",
              )
            )["contextualStudyV5:00000000-0000-4000-8000-000000000001"],
        ),
        originalProgress,
        "favorite reader preserves source progress",
      );
      await page.getByRole("button", { name: "返回收藏", exact: true }).click();
      const syncToggle = library.getByRole("switch", { name: "Google Drive 同步", exact: true });
      await library.getByRole("button", { name: "同步設定", exact: true }).click();
      const syncSettings = page.getByRole("dialog", { name: "同步設定", exact: true });
      const syncAccount = syncSettings.getByRole("combobox", { name: "同步帳號", exact: true });
      assert.equal(
        await syncAccount.innerText(),
        "language.learning.secondary.account@example.test",
        "the lesson backup account is selected without another account choice",
      );
      await page.keyboard.press("Escape");
      await syncSettings.waitFor({ state: "hidden" });
      await page.evaluate(() => {
        window.acceptance.failNextFavoriteConfiguration = true;
      });
      await syncToggle.click();
      await library.getByRole("alert").waitFor();
      assert.equal(
        await library.locator("li").count(),
        1,
        "a failed enable keeps existing local favorites visible",
      );
      assert.equal(await syncToggle.getAttribute("aria-checked"), "false");
      await syncToggle.click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-ui="favorites-library"] [role="switch"]')
            ?.getAttribute("aria-checked") === "true",
      );
      await page.waitForFunction(() =>
        window.acceptance.commands.some(
          command =>
            command.type === "syncFavorites" && command.collection.accountId === "drive-second",
        ),
      );
      const enables = await page.evaluate(() =>
        window.acceptance.commands
          .filter(
            command => command.type === "configureFavorites" && command.change.kind === "enable",
          )
          .map(command => command.change),
      );
      assert.equal(enables.length, 2);
      assert.equal(enables[0].accountId, "drive-second");
      assert.equal(enables[0].importLocal, true);
      assert.equal(
        enables[0].mutationId,
        enables[1].mutationId,
        "retrying the single switch preserves its durable identity",
      );
      await library.locator("li").waitFor();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])')].some(
            element => element.textContent.includes("無法更新收藏"),
          ),
        null,
        { timeout: 2000 },
      );
      await library.getByRole("button", { name: "同步設定", exact: true }).click();
      await syncSettings.waitFor();
      assert.equal(
        await syncAccount.isDisabled(),
        true,
        "an active sync account cannot be changed implicitly",
      );
      const syncCount = await page.evaluate(
        () => window.acceptance.commands.filter(command => command.type === "syncFavorites").length,
      );
      await syncSettings.getByRole("button", { name: "立即同步", exact: true }).click();
      await page.waitForFunction(
        count =>
          window.acceptance.commands.filter(command => command.type === "syncFavorites").length >
          count,
        syncCount,
      );
      await page.screenshot({
        path: join(output, `favorite-sync-settings-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await syncSettings.waitFor({ state: "hidden" });
      await syncToggle.click();
      await library.getByText("僅存本機", { exact: true }).waitFor();
      assert.equal(
        await library.locator("li").count(),
        1,
        "disabling sync keeps the same favorites visible",
      );
      assert.equal(await syncToggle.getAttribute("aria-checked"), "false");
      await page.screenshot({
        path: join(output, `favorite-sync-disabled-${width}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await library
        .locator("li")
        .first()
        .getByRole("button", { name: /取消收藏此情境/ })
        .click();
      await confirmRemoval(page);
      await library.getByText("還沒有收藏。", { exact: false }).waitFor();
      await syncToggle.click();
      await library.getByText("已同步", { exact: true }).waitFor();
      assert.equal(
        await library.locator("li").count(),
        0,
        "reenabling sync does not resurrect a canceled imported favorite",
      );
      await syncToggle.click();
      await library.getByText("僅存本機", { exact: true }).waitFor();
      await library.getByRole("button", { name: "同步設定", exact: true }).click();
      await syncAccount.click();
      await page.getByRole("option", { name: "learner@example.test", exact: true }).click();
      assert.equal(
        await library.locator("li").count(),
        0,
        "choosing a different account does not switch or clear the displayed list",
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.acceptance.commands.filter(
              command =>
                command.type === "configureFavorites" &&
                command.change.accountId === "drive-preview",
            ).length,
        ),
        0,
        "account selection alone never enables or uploads to another account",
      );
      await page.keyboard.press("Escape");
      await syncSettings.waitFor({ state: "hidden" });
      await noOverflow(page);
      assert.deepEqual(errors, []);
      await page.close();
    }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        viewports: [320, 480, 548],
        themes: ["light", "dark"],
        scope:
          "Real App and controller with synthetic Host. No installed extension or live Google Drive.",
      },
      null,
      2,
    ),
  );
  console.log(`Favorites acceptance passed. Screenshots and result at ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
