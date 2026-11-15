import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { customContentCopy } from "../src/i18n/custom-content.ts";
import { sidePanelLayoutCopy } from "../src/i18n/side-panel-layout.ts";
import { translate } from "../src/i18n/messages.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-library-layout-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
const scenarios = [
  ...[320, 550, 900].flatMap(width =>
    ["light", "dark"].map(theme => ({ width, theme, locale: "zh-TW" })),
  ),
  ...["en", "zh-CN", "ja", "ko"].map(locale => ({ width: 320, theme: "light", locale })),
];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const { width, theme, locale } of scenarios) {
    const page = await browser.newPage({
      viewport: { width, height: 850 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(
      server.resolvedUrls.local[0] + `dev/library-preview.html?theme=${theme}&locale=${locale}`,
    );
    const library = page.locator('section[aria-labelledby="library-heading"]');
    const group = library.locator('[data-ui="library-group"]');
    const trigger = group.locator("button[aria-expanded]").first();
    const cards = library.locator('[data-ui="library-entry"]');
    const ui = sidePanelLayoutCopy[locale];
    const copy = customContentCopy(locale);
    const language = library.getByRole("group", { name: ui.filterLanguage });
    const type = library.getByRole("group", { name: copy.type });
    const assertFits = async () => {
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.equal(
        await library.evaluate(el =>
          [...el.querySelectorAll('[data-ui="library-entry"], [data-ui="library-group"]')].every(
            item => item.scrollWidth <= item.clientWidth,
          ),
        ),
        true,
      );
    };
    await trigger.waitFor();
    assert.equal(await group.count(), 1);
    assert.match(await trigger.textContent(), /4/);
    assert.equal(
      await trigger
        .locator(".line-clamp-2")
        .evaluate(
          el =>
            el.getBoundingClientRect().height <=
            2 * parseFloat(getComputedStyle(el).lineHeight) + 1,
        ),
      true,
      "long source headings use at most two lines",
    );
    await trigger.hover();
    assert.equal(await trigger.evaluate(el => getComputedStyle(el).textDecorationLine), "none");
    await assertFits();
    await page.screenshot({
      path: join(output, `collapsed-${width}-${theme}-${locale}.png`),
      fullPage: true,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await group.locator('[data-ui="library-entry"]').first().waitFor();
    assert.equal(
      await group.locator('[data-ui="library-entry"]').count(),
      4,
      "local/Drive copies count once",
    );
    const studied = group.locator("article").filter({ hasText: "第10集：第10集" });
    await page.waitForFunction(() =>
      document.querySelector('[role="progressbar"][aria-valuenow="25"]'),
    );
    assert.equal(await studied.getByRole("progressbar").getAttribute("aria-valuenow"), "25");
    assert.doesNotMatch(await cards.allTextContents().then(texts => texts.join(" ")), /V5|V6/);
    const justice = cards.filter({ hasText: "正義使者" });
    assert.equal(
      (await justice.textContent()).match(/正義使者/g).length,
      1,
      "identical source title is omitted",
    );
    const notes = group.locator("article").filter({ hasText: "重點筆記" });
    await notes.getByRole("button", { name: translate(locale, "openLesson"), exact: true }).click();
    await studied.getByRole("button", { name: ui.continueStudy, exact: true }).click();
    await group.locator("article").filter({ hasText: "雲端摘要" }).getByRole("button").click();
    assert.deepEqual(await page.evaluate(() => window.acceptance.opened), ["notes", "lesson-one"]);
    assert.deepEqual(await page.evaluate(() => window.acceptance.restored), ["cloud"]);
    await assertFits();
    await page.screenshot({
      path: join(output, `expanded-${width}-${theme}-${locale}.png`),
      fullPage: true,
    });
    await type.getByRole("button", { name: copy.custom, exact: true }).click();
    assert.match(await trigger.textContent(), /2/);
    await language.getByRole("button").nth(1).click();
    assert.equal(await group.count(), 0);
    assert.equal(await cards.count(), 0);
    assert.ok((await library.textContent()).includes(translate(locale, "lessonSearchEmpty")));
    await language.getByRole("button", { name: ui.allLanguages, exact: true }).click();
    await type.getByRole("button", { name: copy.all, exact: true }).click();
    await library.getByRole("searchbox").fill("重點筆記");
    assert.equal(await group.count(), 1);
    assert.equal(
      await trigger.getAttribute("aria-expanded"),
      "true",
      "search reveals matching grouped content",
    );
    assert.equal(await group.locator("article").count(), 4);
    await assertFits();
    assert.deepEqual(errors, []);
    console.log(
      `PASS library ${width}px ${theme} ${locale}: grouping, keyboard, progress, actions, filters, search, overflow`,
    );
    await page.close();
  }
  console.log("Library screenshots:", output);
} finally {
  await browser?.close();
  await server.close();
}
