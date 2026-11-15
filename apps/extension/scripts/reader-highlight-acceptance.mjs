import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mockYouTube } from "../../web/scripts/fake-youtube.mjs";
const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const webRoot = fileURLToPath(new URL("../../web", import.meta.url));
const output = fileURLToPath(new URL("../../../.audit/reader-row-hover/", import.meta.url));
const servers = [];
let browser;
try {
  await mkdir(output, { recursive: true });
  for (const root of [extensionRoot, webRoot]) {
    const server = await createServer({
      root,
      configFile: join(root, "vite.config.ts"),
      server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
    });
    await server.listen();
    servers.push(server);
  }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const results = [];
  for (const surface of ["extension", "web"])
    for (const width of [320, 480])
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width: surface === "web" ? 1165 : width, height: 850 },
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(12000);
        const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        if (surface === "web") {
          await mockYouTube(page);
          await page.goto(servers[1].resolvedUrls.local[0] + "?demo=1");
          await page
            .locator(".cards > li")
            .filter({ hasText: "完整情境教材" })
            .getByRole("button")
            .click();
          const separator = page.getByRole("separator", { name: "調整教材欄寬度" });
          await separator.focus();
          for (let i = 0; i < 8; i++)
            await separator.press(width === 320 ? "ArrowRight" : "ArrowLeft");
        } else {
          await page.goto(servers[0].resolvedUrls.local[0] + "dev/reader-preview.html?long=ja");
          await page.evaluate(
            dark => document.documentElement.classList.toggle("dark", dark),
            theme === "dark",
          );
        }
        const row = page
          .locator('[data-ui="sourceUtterance"]')
          .filter({ has: page.locator('[data-ui="analysis-toggle"]') })
          .last();
        const trigger = row.locator('[data-ui="analysis-toggle"]');
        const sentence = row.locator('[data-ui="sourceSentence"]').last();
        await sentence.locator('[data-ui="cue-play"]').click();
        await row.locator('[data-ui="sourceSentence"][aria-current="true"]').waitFor();
        await trigger.focus();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Shift+Tab");
        if ((await trigger.getAttribute("aria-expanded")) === "false") await trigger.press("Enter");
        await row.locator('[data-ui="analysis-content"]').waitFor();
        const triggerBox = await trigger.boundingBox();
        await trigger.hover({ position: { x: triggerBox.width - 8, y: triggerBox.height / 2 } });
        await page.waitForFunction(() => {
          const trigger = document.querySelector('[data-ui="analysis-toggle"]:hover');
          const current = trigger
            ?.closest('[data-ui="sourceUtterance"]')
            ?.querySelector('[data-ui="sourceSentence"][aria-current="true"]');
          return (
            current &&
            getComputedStyle(trigger).backgroundColor === getComputedStyle(current).backgroundColor
          );
        });
        const metrics = await row.evaluate(node => {
          const trigger = node.querySelector('[data-ui="analysis-toggle"]'),
            current = node.querySelector('[data-ui="sourceSentence"][aria-current="true"]');
          const header = node.querySelector('[data-ui="analysis-source-header"]');
          return {
            trigger: trigger.getBoundingClientRect().toJSON(),
            current: current.getBoundingClientRect().toJSON(),
            header: header.getBoundingClientRect().toJSON(),
            range: node
              .querySelector('[data-ui="analysis-range"]')
              .getBoundingClientRect()
              .toJSON(),
            text: current
              .querySelector('[data-ui="sentence-text"]')
              .getBoundingClientRect()
              .toJSON(),
            hoverBackground: getComputedStyle(trigger).backgroundColor,
            shadow: getComputedStyle(trigger).boxShadow,
            offset: getComputedStyle(trigger).getPropertyValue("--tw-ring-offset-width"),
            playingBackground: getComputedStyle(current).backgroundColor,
          };
        });
        assert.ok(
          metrics.current.top - metrics.trigger.bottom >= 3.5,
          "focus/hover area is separated from the playing row",
        );
        assert.ok(
          Math.abs(metrics.trigger.width - metrics.header.width) < 1,
          "disclosure hover covers the full available row",
        );
        assert.ok(
          Math.abs(metrics.trigger.left - metrics.current.left) < 1,
          "highlight left edges align",
        );
        assert.ok(
          Math.abs(metrics.range.left - metrics.text.left) < 1,
          "number and sentence text align",
        );
        assert.equal(
          metrics.hoverBackground,
          metrics.playingBackground,
          "far-edge hover highlights the row",
        );
        assert.notEqual(
          metrics.playingBackground,
          "rgba(0, 0, 0, 0)",
          "playing state remains visible",
        );
        assert.ok(metrics.shadow.includes("inset"), "keyboard focus stays inside its trigger");
        assert.equal(metrics.offset.trim(), "0px");
        assert.equal(await trigger.getAttribute("aria-expanded"), "true");
        await page.screenshot({
          path: join(output, `${surface}-${width}-${theme}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await trigger.click({ position: { x: triggerBox.width - 8, y: triggerBox.height / 2 } });
        assert.equal(await trigger.getAttribute("aria-expanded"), "false");
        assert.deepEqual(errors, []);
        results.push({ surface, width, theme, ...metrics });
        console.log(
          `PASS ${surface} ${width}px ${theme}: full-row hover/click, aligned left edges/text, inset focus, no overlap`,
        );
        await context.close();
      }
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  for (const server of servers) await server.close();
}
