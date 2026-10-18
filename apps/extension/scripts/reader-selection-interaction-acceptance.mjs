import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [resolve(root, "../..")] } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480])
    for (const dark of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 1100 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(server.resolvedUrls.local[0] + "dev/reader-preview.html?cross&speech=mock", {
        waitUntil: "networkidle",
      });
      await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
      const fragment = page.locator('[data-ui="source-chunk-hover"]').first();
      const popup = page.locator('[data-ui="selection-speech-popup"]');
      const selectExplanation = async () => {
        await page
          .locator('[data-ui="coreExplanation"] [data-ui="explanation-text"] p')
          .first()
          .evaluate(element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
          });
        await popup.waitFor();
      };
      await fragment.press("Enter");
      assert.equal(await fragment.getAttribute("aria-checked"), "true");
      for (const expected of [false, true]) {
        await selectExplanation();
        await fragment.click();
        assert.equal(
          await fragment.getAttribute("aria-checked"),
          String(expected),
          "a single click toggles the fragment while the selection speech popup is open",
        );
        assert.equal(
          await page.locator('[data-ui="selectedChunkMeaning"]').count(),
          Number(expected),
        );
        await popup.waitFor({ state: "hidden" });
      }
      // Start on ordinary source text and drag across its embedded fragment button.
      const drag = await page
        .locator('[data-source-cue="cue-2"] [data-ui="sentence-text"]')
        .evaluate(element => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const nodes = [];
          while (walker.nextNode()) nodes.push(walker.currentNode);
          const caret = (node, offset) => {
            const range = document.createRange();
            range.setStart(node, offset);
            range.collapse(true);
            const box = range.getBoundingClientRect();
            return { x: box.x, y: box.y + box.height / 2 };
          };
          return {
            start: caret(nodes[0], 0),
            end: caret(nodes.at(-1), nodes.at(-1).textContent.length - 1),
          };
        });
      await page.mouse.move(drag.start.x + 1, drag.start.y);
      await page.mouse.down();
      await page.mouse.move(drag.end.x, drag.end.y, { steps: 12 });
      await page.mouse.up();
      assert.ok(await page.evaluate(() => !!window.getSelection()?.toString()));
      assert.equal(
        await fragment.getAttribute("aria-checked"),
        "true",
        "text selection preserves the active fragment",
      );
      await popup.waitFor();
      const group = page.locator('[data-ui="analysis-toggle"]').last();
      const all = page.locator('[data-ui="analysis-toggle-all"]');
      const selectSource = async () => {
        await page
          .locator('[data-source-cue="cue-2"] [data-ui="sentence-text"]')
          .evaluate(element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
          });
        await popup.waitFor();
      };
      for (const action of ["mouse", "keyboard"]) {
        for (const expanded of [false, true]) {
          await selectSource();
          if (action === "mouse") await group.click();
          else await group.press("Enter");
          assert.equal(await group.getAttribute("aria-expanded"), String(expanded));
          assert.equal(
            await page.evaluate(() => window.getSelection().toString()),
            "",
            "group disclosure clears the retained text selection",
          );
          await popup.waitFor({ state: "hidden" });
        }
      }
      // Start with every group open, then exercise collapse/expand from both input methods.
      if (
        (await page
          .locator('[data-ui="analysis-toggle"]')
          .first()
          .getAttribute("aria-expanded")) === "false"
      )
        await all.click();
      for (const action of ["mouse", "keyboard"]) {
        for (const expanded of [false, true]) {
          await selectSource();
          if (action === "mouse") await all.click();
          else await all.press("Space");
          assert.equal(await group.getAttribute("aria-expanded"), String(expanded));
          assert.equal(
            await page.evaluate(() => window.getSelection().toString()),
            "",
            "global disclosure clears the retained text selection",
          );
          await popup.waitFor({ state: "hidden" });
        }
      }
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          width,
          dark,
          fragmentTogglesWithPopup: "passed",
          dragSelection: "passed",
          disclosureClearsSelection: "passed",
        }),
      );
      await page.close();
    }
} finally {
  await browser?.close();
  await server.close();
}
