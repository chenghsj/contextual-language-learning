import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve("docs/quality/reader-group-disclosure");
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: false,
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    host: "127.0.0.1",
    port: 5193,
    strictPort: true,
    fs: { allow: [resolve(root, "../..")] },
  },
});
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480])
    for (const dark of [false, true])
      for (const mode of ["multi", "cross"]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } }),
          errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.goto(`http://127.0.0.1:5193/dev/reader-preview.html?${mode}`, {
          waitUntil: "networkidle",
        });
        await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
        const toggles = page.locator('[data-ui="analysis-toggle"]');
        const panels = page.locator('[data-ui="analysis-content"]');
        await toggles.first().waitFor();
        assert.equal(await toggles.count(), 2);
        assert.equal(await page.locator('[data-ui="core-explanation-toggle"]').count(), 0);
        assert.equal(await page.locator('[data-ui="analysis-content"]:visible').count(), 0);
        if (width === 480 && !dark && mode === "cross")
          await page.screenshot({
            path: join(output, "reader-group-collapsed.png"),
            fullPage: true,
          });
        await toggles.first().press("Enter");
        assert.equal(await panels.first().isVisible(), true);
        await toggles.last().press("Space");
        assert.equal(await page.locator('[data-ui="analysis-content"]:visible').count(), 2);
        await page.locator('[data-ui="cue-play"]').last().click();
        assert.equal(await toggles.last().getAttribute("aria-expanded"), "true");
        assert.equal(await page.locator('[data-ui="teaching-unit-selector"]').count(), 0);
        assert.equal(await page.locator('[data-ui="analysis-toggle-all"]').count(), 1);
        assert.equal(await page.locator('[data-ui="analysis-group"]').count(), 2);
        const wholeReading = await page.locator('[data-ui="analysis-group"]').allTextContents();
        if (mode === "multi") {
          assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 3);
          const titles = await page.locator('[data-ui="analysis-source-title"]').allTextContents();
          assert.deepEqual(titles, ["I was about to head out", "when you called."]);
        } else {
          assert.equal(await page.locator('[data-ui="sourceSentence"]').count(), 3);
          assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 2);
          assert.equal(
            await page.locator('[data-ui="analysis-group"]').last().getAttribute("data-source-cue"),
            "cue-3",
          );
        }
        const fragments = page.locator('[data-ui="source-chunk-hover"]');
        if (await fragments.count()) {
          await fragments.first().press("Enter");
          assert.equal(await page.locator('[data-ui="selectedChunkMeaning"]').count(), 1);
          if (width === 480 && !dark && mode === "cross")
            await page.screenshot({
              path: join(output, "reader-group-selected.png"),
              fullPage: true,
            });
          assert.deepEqual(
            await page.locator('[data-ui="analysis-group"]').allTextContents(),
            wholeReading,
          );
          assert.equal(await page.locator('[data-ui="close-chunk"]').count(), 0);
          await fragments.first().press("Enter");
          assert.equal(await page.locator('[data-ui="selectedChunkMeaning"]').count(), 0);
          assert.equal(await fragments.first().evaluate(e => e === document.activeElement), true);
          assert.equal(await page.locator('[data-ui="chunk-comparison-toggle"]').count(), 0);
        }
        await page.locator('[data-ui="sentence-text"]').first().click();
        assert.equal(await toggles.first().getAttribute("aria-expanded"), "false");
        assert.equal(await toggles.last().getAttribute("aria-expanded"), "true");
        const all = page.locator('[data-ui="analysis-toggle-all"]');
        await all.click();
        assert.equal(await page.locator('[data-ui="analysis-content"]:visible').count(), 2);
        await all.click();
        assert.equal(await page.locator('[data-ui="analysis-content"]:visible').count(), 0);
        await all.click();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        assert.deepEqual(errors, []);
        const screenshot = `reader-${width}-${dark ? "dark" : "light"}-${mode}.png`;
        await page.screenshot({ path: join(output, screenshot), fullPage: true });
        assert.equal(await page.locator('[data-ui="analysis-group"]').count(), 2);
        results.push({ width, dark, mode, screenshot, status: "passed" });
        await page.close();
      }
  await writeFile(
    join(output, "acceptance.json"),
    JSON.stringify(
      {
        results,
        boundary:
          "Real Chrome engine, synthetic source and simulated video adapter; not installed extension or provider playback.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: results.length, output }));
} finally {
  await browser?.close();
  await server.close();
}
