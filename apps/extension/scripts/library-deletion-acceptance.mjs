import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { libraryDeleteCopy } from "../src/i18n/library-delete.ts";
import { translate } from "../src/i18n/messages.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-library-delete-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const scenario of process.argv.includes("--legacy-only")
    ? []
    : [
        { width: 320, height: 850, theme: "light", locale: "zh-TW" },
        { width: 900, height: 850, theme: "dark", locale: "zh-TW" },
        ...["en", "zh-CN", "ja", "ko"].map(locale => ({
          width: 320,
          height: 320,
          theme: "light",
          locale,
        })),
      ]) {
    const { width, height, theme, locale } = scenario;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(
      server.resolvedUrls.local[0] +
        `dev/library-preview.html?locale=${locale}&theme=${theme}&delete=fail`,
    );
    const copy = libraryDeleteCopy(locale);
    const library = page.locator('section[aria-labelledby="library-heading"]');
    const dragon = library.locator("article").filter({ hasText: "電影版小林" });
    const remove = dragon.getByRole("button", { name: new RegExp("^" + copy.action) });
    await remove.hover();
    assert.equal(await page.getByRole("tooltip").count(), 0);
    assert.equal(await remove.getAttribute("title"), null);
    await remove.click();
    let dialog = page.getByRole("alertdialog");
    await dialog.getByText(copy.hint, { exact: true }).waitFor();
    await dialog.getByText(copy.kept, { exact: true }).waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: copy.cancel, exact: true })
        .evaluate(el => el === document.activeElement),
      true,
      "cancel receives initial focus",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await dialog.evaluate(
        el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height <= innerHeight,
      ),
      true,
    );
    await page.screenshot({
      path: join(output, `confirm-${width}-${height}-${theme}-${locale}.png`),
    });
    await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.acceptance.deleted), []);
    assert.equal(await remove.evaluate(el => el === document.activeElement), true);
    await remove.click();
    dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: copy.action, exact: true }).click();
    const pending = dialog.getByRole("button", { name: copy.deleting, exact: true });
    await pending.waitFor();
    assert.equal(await pending.isDisabled(), true);
    assert.equal(
      await dialog.getByRole("button", { name: copy.cancel, exact: true }).isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dragon.count(), 1, "failed deletion keeps the document");
    assert.equal(await dialog.getByRole("alert").locator(":scope > p").textContent(), copy.error);
    await dialog.getByRole("button", { name: copy.action, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await dragon.count(), 0);
    assert.deepEqual(await page.evaluate(() => window.acceptance.deleted), ["dragon", "dragon"]);
    assert.equal(
      await page.locator("#library-heading").evaluate(el => el === document.activeElement),
      true,
      "deleting a row restores focus to the library heading",
    );
    await library.locator('[data-ui="library-group"] button[aria-expanded]').click();
    const notes = library.locator("article").filter({ hasText: "重點筆記" });
    await notes.getByRole("button", { name: new RegExp("^" + copy.action) }).click();
    dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: copy.action, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await notes.getByRole("button", { name: new RegExp("^" + copy.action) }).count(),
      0,
      "cloud-only documents have no local delete action",
    );
    await notes
      .getByRole("button", { name: translate(locale, "restoreLesson"), exact: true })
      .click();
    assert.deepEqual(await page.evaluate(() => window.acceptance.restored), ["notes"]);
    await library.getByRole("button", { name: copy.batchDelete, exact: true }).click();
    const selectionBar = library.locator('[data-ui="library-selection"]');
    assert.equal(
      await selectionBar.getByRole("button", { name: copy.exitSelection, exact: true }).count(),
      1,
      "exit selection stays beside bulk actions",
    );
    assert.equal(
      await library
        .locator('[data-ui="library-header"]')
        .getByRole("button", { name: copy.done, exact: true })
        .count(),
      0,
    );
    assert.equal(
      await selectionBar.getByRole("checkbox").evaluate(el => el === document.activeElement),
      true,
    );
    await selectionBar.getByRole("button", { name: copy.exitSelection, exact: true }).click();
    assert.equal(
      await library
        .getByRole("button", { name: copy.batchDelete, exact: true })
        .evaluate(el => el === document.activeElement),
      true,
    );
    await library.getByRole("button", { name: copy.batchDelete, exact: true }).click();
    const checkboxes = library.locator("article").getByRole("checkbox");
    assert.equal(
      await checkboxes.count(),
      3,
      "selection expands groups and excludes cloud-only rows",
    );
    assert.equal(
      await library
        .getByRole("button", { name: copy.deleteSelected.replace("{count}", "0"), exact: true })
        .count(),
      0,
      "empty selection has no disabled delete action",
    );
    await checkboxes.first().check();
    assert.equal(
      await library
        .getByRole("checkbox", { name: copy.selectAll, exact: true })
        .evaluate(el => el.indeterminate),
      true,
    );
    assert.equal(
      await checkboxes
        .first()
        .evaluate(
          el =>
            el.getBoundingClientRect().right <
            el.closest("article").querySelector("h3").getBoundingClientRect().left,
        ),
      true,
      "checkbox is aligned to the left of the content",
    );
    await library.getByRole("searchbox").fill("no matching documents");
    await library.getByRole("searchbox").fill("");
    assert.equal(
      await library.locator("article input:checked").count(),
      0,
      "changing filters clears selection",
    );
    await library.getByRole("checkbox", { name: copy.selectAll, exact: true }).check();
    assert.equal(await library.locator("article input:checked").count(), 3);
    const bulkLabel = copy.deleteSelected.replace("{count}", "3");
    const bulk = library.getByRole("button", { name: bulkLabel, exact: true });
    await bulk.click();
    dialog = page.getByRole("alertdialog");
    await dialog
      .getByRole("heading", { name: copy.batchTitle.replace("{count}", "3"), exact: true })
      .waitFor();
    assert.equal(await dialog.locator("ul").first().locator("li").count(), 3);
    await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await library.locator("article input:checked").count(), 3);
    await bulk.click();
    await dialog.waitFor();
    assert.equal(
      await dialog.evaluate(
        el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height <= innerHeight,
      ),
      true,
      "batch confirmation fits narrow and short windows",
    );
    await page.screenshot({
      path: join(output, `batch-${width}-${height}-${theme}-${locale}.png`),
    });
    await page.evaluate(() => {
      window.acceptance.deleteFailures = 1;
    });
    await dialog.getByRole("button", { name: bulkLabel, exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(
      await dialog.getByRole("alert").locator(":scope > p").textContent(),
      copy.partialError.replace("{deleted}", "2").replace("{failed}", "1"),
    );
    assert.equal(
      await library.locator("article input:checked").count(),
      1,
      "only failed selections remain",
    );
    assert.equal(
      await dialog.locator("ul").first().locator("li").count(),
      1,
      "retry targets only failures",
    );
    await dialog.getByRole("button", { name: copy.action, exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await checkboxes.count(), 0);
    assert.equal(await library.locator("article input:checked").count(), 0);
    assert.equal(
      await page.locator("#library-heading").evaluate(el => el === document.activeElement),
      true,
      "completed batch returns focus to the heading when its action is disabled",
    );
    await library.getByRole("button", { name: copy.exitSelection, exact: true }).click();
    assert.deepEqual(errors, []);
    console.log(
      `PASS delete ${width}x${height} ${theme} ${locale}: cancel/focus, pending/Escape, failure/retry, standard/custom, cloud restore`,
    );
    await page.close();
  }
  const legacyPage = await browser.newPage({
    viewport: { width: 390, height: 740 },
    reducedMotion: "reduce",
  });
  await legacyPage.goto(
    server.resolvedUrls.local[0] + "dev/library-preview.html?delete=unsupported",
  );
  const legacyCopy = libraryDeleteCopy("zh-TW");
  const legacyRow = legacyPage.locator("article").filter({ hasText: "電影版小林" });
  await legacyRow.getByRole("button", { name: /^刪除本機文件/ }).click();
  const legacyDialog = legacyPage.getByRole("alertdialog");
  await legacyDialog.getByRole("button", { name: legacyCopy.action, exact: true }).click();
  await legacyDialog
    .getByRole("alert")
    .getByText(legacyCopy.hostUpdate, { exact: true })
    .waitFor({ timeout: 3000 });
  assert.equal(await legacyRow.count(), 1, "unsupported Hosts preserve the document");
  assert.doesNotMatch(await legacyDialog.getByRole("alert").textContent(), /Invalid discriminator/);
  await legacyPage.screenshot({
    path: join(output, "unsupported-host.png"),
    animations: "disabled",
  });
  await legacyPage.close();
  console.log("PASS unsupported installed Host reports an actionable localized reason");
  console.log("Deletion screenshots:", output);
} finally {
  await browser?.close();
  await server.close();
}
