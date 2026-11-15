import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Real reader with synthetic long Japanese dialogue and simulated video playback.
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
  for (const width of [320, 480])
    for (const theme of ["light", "dark"])
      for (const cross of [false, true]) {
        const page = await browser.newPage({
          viewport: { width, height: 850 },
          reducedMotion: "reduce",
        });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.route("**/dev/reader-preview.tsx", async route => {
          const response = await route.fetch();
          const original = await response.text();
          const mount = 'createRoot(document.getElementById("root"))';
          const reactModule = original.match(/["']([^"']*\/react\.js[^"']*)["']/)?.[1];
          assert.ok(reactModule, "preview React module is available");
          assert.ok(
            original.includes(mount),
            "preview mount is available for the simulated speech provider",
          );
          const body =
            `import PreviewReact from ${JSON.stringify(reactModule)};
          import { SystemSpeechProvider } from "../src/components/system-speech.tsx";
          import { SpeechController } from "../src/native/speech-controller.ts";
          window.speechRequests = [];
          const speech = new SpeechController(onMessage => ({ close() {}, send(request) {
            window.speechRequests.push(request);
            queueMicrotask(() => onMessage(request.type === "listSpeechVoices"
              ? {id:request.id,type:"speechVoices",supported:true,voices:[{id:"ja",name:"Japanese",language:"ja-JP",quality:"enhanced"},{id:"en",name:"English",language:"en-US",quality:"enhanced"}]}
              : request.type === "speak" ? {id:request.id,type:"speechFinished",status:"completed"}
              : {id:request.id,type:"speechStopped"}));
          }}));\n` +
            original
              .replace(
                'longReadingV7Fixture(params.get("long") === "ko" ? "ko" : "ja")',
                '(() => { const doc = longReadingV7Fixture("ja"); doc.sections[0].utterances[1].contextExplanation = "長篇解讀測試：確認條件與後续安排。".repeat(60); return doc; })()',
              )
              .replace(
                mount,
                '((element) => { const root = createRoot(element); return { render(node) { root.render(PreviewReact.createElement(SystemSpeechProvider, {controller:speech}, node)); } }; })(document.getElementById("root"))',
              );
          await route.fulfill({ response, body });
        });
        await page.goto(
          server.resolvedUrls.local[0] + "dev/reader-preview.html?" + (cross ? "cross" : "long=ja"),
        );
        await page.evaluate(
          theme => document.documentElement.classList.toggle("dark", theme === "dark"),
          theme,
        );
        await page.evaluate(
          () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        assert.deepEqual(errors, [], "speech preview loads without runtime errors");
        const groups = page.locator('[data-ui="analysis-toggle"]');
        await groups.last().waitFor();
        const speechButtons = page.locator('[data-ui="analysis-source-header"] button');
        await speechButtons.last().waitFor();
        assert.equal(await speechButtons.count(), 2, "one speech action per source group");
        assert.equal(
          await page.locator('[data-ui="sentence-actions"] button').count(),
          cross ? 3 : 2,
          "cue rows only contain video playback",
        );
        const expectedSpeech = await page
          .locator('[data-ui="sourceUtterance"]')
          .last()
          .locator('[data-ui="sentence-text"] [lang]')
          .evaluateAll(elements =>
            elements
              .map(element => {
                const clone = element.cloneNode(true);
                clone.querySelectorAll("rt, rp").forEach(node => node.remove());
                return clone.textContent;
              })
              .join(" "),
          );
        await speechButtons.last().click();
        await page.waitForFunction(() =>
          window.speechRequests.some(request => request.type === "speak"),
        );
        const spoken = await page.evaluate(
          () => window.speechRequests.find(request => request.type === "speak").input.text,
        );
        assert.equal(
          spoken.replace(/\s+/gu, " ").trim(),
          expectedSpeech.replace(/\s+/gu, " ").trim(),
          "the remaining speech button reads the complete group",
        );
        const open = () => page.locator('[data-ui="selectedChunkMeaning"]').count();
        assert.equal(await open(), 0);
        assert.equal(await page.locator('[data-ui="analysis-group"]').count(), 0);
        assert.equal(await page.locator('[data-ui="source-chunk-hover"]').count(), 2);
        assert.equal(await page.locator('[data-ui="source-chunk"]').count(), 0);
        const source = page.locator('[data-ui="sourceSentence"]').last();
        const sourceBox = await source.boundingBox();
        const toggleBox = await groups.last().boundingBox();
        assert.ok(
          toggleBox.y >= sourceBox.y + sourceBox.height - 1,
          "interpretation switch follows the complete source",
        );
        await page.locator('[data-ui="sentence-number"]').last().click();
        assert.equal(await page.locator('[data-ui="analysis-group"]').count(), 0);
        await page.screenshot({
          path: `/tmp/reader-chunks-collapsed-${width}-${theme}-${cross ? "cross" : "long"}.png`,
        });
        const fragments = page.locator('[data-ui="source-chunk-hover"]');
        const scrollBefore = await page
          .locator('[data-ui="lessonContent"]')
          .evaluate(element => element.scrollTop);
        await fragments.first().click();
        assert.equal(await open(), 1, "source click shows only the chosen chunk interpretation");
        assert.equal(await fragments.first().getAttribute("aria-checked"), "true");
        const mode = page.locator('[data-ui="analysis-mode"]');
        assert.equal(await mode.textContent(), "片段解讀");
        const modeBox = await mode.boundingBox();
        const collapseBox = await groups.last().boundingBox();
        assert.ok(
          Math.abs(modeBox.y + modeBox.height / 2 - collapseBox.y - collapseBox.height / 2) < 2,
          "the Chinese interpretation heading and actions share one row",
        );
        await page.mouse.move(0, 0);
        assert.equal(
          await fragments
            .first()
            .evaluate(element => getComputedStyle(element).textDecorationThickness),
          "2px",
          "the selected fragment remains distinct after hover leaves",
        );
        const panelId = await page.locator('[data-ui="analysis-group"]').getAttribute("id");
        if (!cross) {
          await fragments.first().press("ArrowRight");
          await page.waitForFunction(
            () =>
              document.activeElement ===
              [...document.querySelectorAll('[data-ui="source-chunk-hover"]')].at(-1),
          );
          await fragments.last().press("Space");
          assert.equal(await fragments.first().getAttribute("aria-checked"), "false");
          assert.equal(await fragments.last().getAttribute("aria-checked"), "true");
          assert.equal(await page.getByText("先確認資料這個條件。", { exact: true }).count(), 0);
          await page.getByText("再一起討論並決定具體計畫。", { exact: true }).waitFor();
          assert.equal(
            await page.locator('[data-ui="analysis-group"]').getAttribute("id"),
            panelId,
          );
          assert.equal(
            await open(),
            1,
            "switching replaces rather than accumulates interpretations",
          );
          await fragments.first().evaluate(element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            document.dispatchEvent(new Event("selectionchange"));
          });
          await fragments.first().dispatchEvent("click", { detail: 1 });
          assert.equal(
            await fragments.last().getAttribute("aria-checked"),
            "true",
            "selecting text does not switch chunk interpretations",
          );
          await page.keyboard.press("Escape");
          await page.evaluate(() => window.getSelection().removeAllRanges());
          await page.locator('[data-ui="selection-speech-popup"]').waitFor({ state: "hidden" });
        }
        assert.equal(
          await page.locator('[data-ui="lessonContent"]').evaluate(element => element.scrollTop),
          scrollBefore,
          "source lookup never scrolls the reader",
        );
        await page.screenshot({
          path: `/tmp/reader-selected-fragment-${width}-${theme}-${cross ? "cross" : "long"}.png`,
        });
        const viewFull = page.locator('[data-ui="analysis-view-full"]');
        await viewFull.scrollIntoViewIfNeeded();
        const fullButtonBox = await viewFull.boundingBox();
        assert.ok(
          fullButtonBox.x >= 0 && fullButtonBox.x + fullButtonBox.width <= width,
          "view-full action fits the narrow reader",
        );
        const scrollBeforeFull = await page
          .locator('[data-ui="lessonContent"]')
          .evaluate(element => element.scrollTop);
        await page.locator('[data-ui="analysis-group"]').evaluate(element => {
          window.panelBeforeFull = element;
        });
        await viewFull.click();
        assert.equal(
          await page
            .locator('[data-ui="analysis-group"]')
            .evaluate(element => element === window.panelBeforeFull),
          true,
          "view-full keeps the same panel open",
        );
        assert.equal(await open(), cross ? 1 : 2);
        assert.equal(await groups.last().getAttribute("aria-expanded"), "true");
        assert.equal(await viewFull.count(), 0);
        assert.match(await mode.textContent(), /^整段解讀 · /);
        assert.equal(
          await page.locator('[data-ui="source-chunk-hover"][aria-checked="true"]').count(),
          0,
        );
        assert.equal(
          await page.locator('[data-ui="lessonContent"]').evaluate(element => element.scrollTop),
          scrollBeforeFull,
          "view-full does not jump back to the source",
        );
        await groups.last().click();
        assert.equal(await open(), 0);
        await groups.last().focus();
        await groups.last().press("Enter");
        assert.equal(
          await groups.last().evaluate(element => element === document.activeElement),
          true,
          "expanding retains keyboard focus on collapse",
        );
        const lastMeaning = page.getByText(
          cross ? "正要做某事，這時另一件事發生。" : "再一起討論並決定具體計畫。",
          { exact: true },
        );
        await lastMeaning.waitFor();
        assert.equal(await open(), cross ? 1 : 2);
        assert.equal(await groups.last().textContent(), "收合");
        assert.equal(await page.locator('[data-ui="chunk-explanations"] button').count(), 0);
        assert.equal(await page.locator('[data-ui="chunk-explanations"] svg').count(), 0);
        await lastMeaning.scrollIntoViewIfNeeded();
        const controls = page.locator('[data-ui="analysis-controls"]').last();
        const toolbar = await page.locator('[data-ui="dialogue-toolbar"]').boundingBox();
        const controlsBox = await controls.boundingBox();
        const contentBox = await page.locator('[data-ui="lessonContent"]').boundingBox();
        assert.ok(
          controlsBox.y >= toolbar.y + toolbar.height - 1,
          "group controls do not overlap the reader toolbar",
        );
        assert.ok(
          controlsBox.y + controlsBox.height <= contentBox.y + contentBox.height,
          "collapse remains in the reader viewport",
        );
        const original = await source.boundingBox();
        if (!cross)
          assert.ok(
            original.y + original.height < toolbar.y + toolbar.height,
            "long interpretation scrolls past the original",
          );
        await page.screenshot({
          path: `/tmp/reader-sticky-${width}-${theme}-${cross ? "cross" : "long"}.png`,
        });
        await groups.last().click();
        await page.evaluate(
          () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const restoredSource = await source.boundingBox();
        const restoredToolbar = await page.locator('[data-ui="dialogue-toolbar"]').boundingBox();
        assert.ok(
          restoredSource.y >= restoredToolbar.y + restoredToolbar.height - 1,
          "collapse returns to the complete source",
        );
        await groups.last().click();
        await groups.first().click();
        assert.equal(await page.locator('[data-ui="analysis-group"]').count(), 2);
        await groups.last().click();
        assert.equal(await page.locator('[data-ui="analysis-group"]').count(), 1);
        assert.equal(await open(), 0);
        const all = page.locator('[data-ui="analysis-toggle-all"]');
        await all.click();
        assert.equal(await open(), cross ? 1 : 2);
        assert.equal(await all.textContent(), "全部收合");
        await page
          .locator('[data-ui="dialogue-utterances"]')
          .evaluate(element =>
            Promise.all(
              element
                .getAnimations({ subtree: true })
                .map(animation => animation.finished.catch(() => {})),
            ),
          );
        await lastMeaning.scrollIntoViewIfNeeded();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        const bounds = await page.locator('[data-ui="chunk-explanations"]').evaluateAll(elements =>
          elements.map(element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right };
          }),
        );
        for (const rect of bounds) assert.ok(rect.left >= 0 && rect.right <= width);
        await page.screenshot({
          path: `/tmp/reader-chunks-${width}-${theme}-${cross ? "cross" : "long"}.png`,
        });
        await all.click();
        assert.equal(await page.locator('[data-ui="analysis-group"]').count(), 0);
        assert.equal(await groups.last().textContent(), "查看解讀");
        await groups.last().click();
        assert.equal(await open(), cross ? 1 : 2);
        assert.deepEqual(errors, []);
        console.log(
          `PASS group speech and sticky collapse ${width} ${theme} ${cross ? "cross" : "long"}`,
        );
        await page.close();
      }
  for (const locale of ["en", "zh-CN", "ja", "ko"]) {
    const page = await browser.newPage({
      viewport: { width: 320, height: 850 },
      reducedMotion: "reduce",
    });
    await page.goto(
      server.resolvedUrls.local[0] + `dev/reader-preview.html?cross&locale=${locale}`,
    );
    await page.locator('[data-ui="source-chunk-hover"]').first().click();
    const controls = page.locator('[data-ui="analysis-controls"]').last();
    const heading = controls.locator('[data-ui="analysis-mode"]');
    await heading.waitFor();
    assert.ok(await heading.textContent());
    const full = controls.locator('[data-ui="analysis-view-full"]');
    const range = await page.locator('[data-ui="analysis-range"]').last().textContent();
    assert.ok((await full.textContent()).includes(range));
    await full.focus();
    await full.press("Enter");
    await full.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.activeElement ===
        [...document.querySelectorAll('[data-ui="analysis-toggle"]')].at(-1),
    );
    assert.ok((await heading.textContent()).includes(range));
    const box = await controls.boundingBox();
    assert.equal(
      await controls.evaluate(element => element.scrollWidth <= element.clientWidth),
      true,
      "translated controls wrap inside their container",
    );
    for (const button of await controls.locator("button").all()) {
      const b = await button.boundingBox();
      assert.ok(
        b.x >= box.x - 1 && b.x + b.width <= box.x + box.width + 1,
        "translated actions remain inside the panel",
      );
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    console.log("PASS localized interpretation controls 320 " + locale);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
