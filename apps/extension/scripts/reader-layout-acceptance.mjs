import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Actual App/reader; simulated Host and video. No installed extension or user data.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-reader-layout-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
async function assertSourceAlignment(page) {
  const measurements = await page.locator('[data-ui="sourceSentence"]').evaluateAll(rows =>
    rows.map(row => {
      const text = row.querySelector('[data-ui="sentence-text"]');
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      let node;
      let glyph;
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest("rt, rp") || !node.textContent.trim()) continue;
        const start = node.textContent.search(/\S/u);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 1);
        glyph = range.getBoundingClientRect();
        break;
      }
      const number = row.querySelector('[data-ui="sentence-number"]');
      const numberRange = document.createRange();
      numberRange.selectNodeContents(number);
      const digit = numberRange.getBoundingClientRect();
      const icon = row.querySelector('[data-ui="cue-play"] svg').getBoundingClientRect();
      const center = box => box.y + box.height / 2;
      return {
        left: Math.abs(glyph.left - text.getBoundingClientRect().left),
        number: number.textContent.trim() ? Math.abs(center(digit) - center(glyph)) : 0,
        control: Math.abs(center(icon) - center(glyph)),
        playX: icon.x,
      };
    }),
  );
  for (const measurement of measurements) {
    assert.ok(
      measurement.left <= 1,
      `visible source text aligns with its column: ${JSON.stringify(measurement)}`,
    );
    assert.ok(
      measurement.number <= 4,
      `number aligns with the first body line: ${JSON.stringify(measurement)}`,
    );
    assert.ok(
      measurement.control <= 4,
      `play aligns with the first body line: ${JSON.stringify(measurement)}`,
    );
  }
  assert.ok(
    Math.max(...measurements.map(item => item.playX)) -
      Math.min(...measurements.map(item => item.playX)) <=
      1,
    "all sentence play controls share one column",
  );
}
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const width of [320, 550, 900, 1280]) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width, height: 800 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(server.resolvedUrls.local[0] + `dev/redesign-preview.html?theme=${theme}`);
      await page.locator("#page-nav-lessons").click();
      await page
        .locator("article")
        .filter({ hasText: "An original video" })
        .getByRole("button")
        .click();
      const reader = page.locator('[data-ui="unifiedReader"]');
      await reader.waitFor();
      const header = reader.locator('[data-ui="reader-header"]');
      const content = reader.locator('[data-ui="lessonContent"]');
      const player = reader.locator("footer");
      const assertOuterFixed = async () => {
        assert.deepEqual(
          await page.evaluate(() => {
            window.scrollTo(0, 1000);
            return {
              scrollY,
              documentFits: document.documentElement.scrollHeight <= innerHeight,
              shellHeights: [
                document.documentElement,
                document.body,
                document.getElementById("root"),
              ].map(el => el.getBoundingClientRect().height),
            };
          }),
          {
            scrollY: 0,
            documentFits: true,
            shellHeights: Array(3).fill(page.viewportSize().height),
          },
          "the document and app shell stay fixed to the viewport",
        );
      };
      const assertFits = async () => {
        const box = await reader.boundingBox();
        assert.deepEqual(box, { x: 0, y: 0, width, height: 800 }, "reader fills the viewport");
        assert.equal(await page.locator('[data-ui="app-header"]').count(), 0);
        assert.equal(await page.locator("#page-nav-lessons").count(), 0);
        await assertOuterFixed();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        assert.equal(await player.evaluate(el => el.scrollWidth <= el.clientWidth), true);
        assert.ok((await player.boundingBox()).height <= 110, "three-row player stays compact");
        const body = await player.locator('[data-ui="player-body"]').boundingBox();
        const expectedWidth = Math.min(width - 24, 720);
        assert.equal(body.width, expectedWidth, "player body stops at 720px");
        assert.equal(body.x, (width - expectedWidth) / 2, "player body is centered");
        for (const selector of ['[data-ui="player-target"]', '[data-ui="player-controls"]']) {
          const row = await player.locator(selector).boundingBox();
          assert.equal(row.width, body.width);
          assert.equal(row.x, body.x);
        }
        assert.equal(
          await player
            .getByRole("slider")
            .evaluate(el => el.parentElement.getBoundingClientRect().width),
          body.width,
          "timeline shares the same width",
        );
        const transport = await player.locator('[data-ui="player-transport"]').boundingBox();
        const play = await player
          .locator('[data-ui="player-transport"] button')
          .nth(1)
          .boundingBox();
        assert.ok(
          Math.abs(play.x + play.width / 2 - width / 2) <= 1,
          "play stays at the viewport center",
        );
        const slider = await player.getByRole("slider").boundingBox();
        assert.ok(
          slider.y >= transport.y + transport.height,
          "timeline follows the transport controls",
        );
        assert.equal(
          await player.locator('[data-ui="player-controls"]').evaluate(el =>
            [...el.querySelectorAll("button")].every(button => {
              const row = el.getBoundingClientRect();
              const box = button.getBoundingClientRect();
              return (
                box.x >= row.x - 1 &&
                box.right <= row.right + 1 &&
                box.y >= row.y &&
                box.bottom <= row.bottom + 1
              );
            }),
          ),
          true,
          "every control fits without wrapping or overlap",
        );
      };
      await assertFits();
      await player.getByRole("combobox", { name: "速度", exact: true }).click();
      await page.getByRole("option", { name: "1.75×", exact: true }).click();
      await assertFits();
      assert.equal(
        await player
          .locator('[data-ui="player-utilities"] [data-slot="select-value"]')
          .evaluate(el => el.scrollWidth <= el.clientWidth),
        true,
        "long speed values stay readable",
      );
      assert.equal(
        await reader.getByRole("heading", { name: "Dinner plans", exact: true }).count(),
        0,
      );
      assert.ok((await player.locator('[data-ui="player-scope"]').textContent()).includes("場景"));
      await page.screenshot({ path: join(output, `reader-${width}-${theme}.png`) });
      const analysisButton = reader.locator('[data-ui="analysis-toggle"]').first();
      assert.equal(
        await analysisButton.evaluate(
          el =>
            !!el.closest('[data-ui="sourceUtterance"]') &&
            !el.closest('[data-ui="sentence-actions"]'),
        ),
        true,
      );
      assert.equal(await reader.getByRole("radio").count(), 0);
      assert.ok((await analysisButton.locator('[data-ui="analysis-range"]').textContent()).trim());
      assert.equal(
        await analysisButton.evaluate(
          el => getComputedStyle(el.closest('[data-ui="sourceUtterance"]')).borderTopWidth,
        ),
        "1px",
        "collapsed sources already show their analysis boundary",
      );
      await analysisButton.click();
      await reader.locator('[data-ui="inlineAnalysis"]').waitFor();
      await reader.locator('[data-ui="inlineAnalysis"] p').first().click();
      assert.equal(
        await analysisButton.getAttribute("aria-expanded"),
        "true",
        "explanation clicks never collapse the group",
      );
      await assertSourceAlignment(page);
      assert.ok(
        await analysisButton
          .locator('[data-ui="analysis-range"]')
          .evaluate(el => el.getBoundingClientRect().height <= 20),
        "the analysis label stays on one line",
      );
      assert.equal(await reader.getByRole("button", { name: "收合解析", exact: true }).count(), 0);
      const analysisGroup = reader
        .locator('[data-ui="sourceUtterance"]')
        .filter({ has: page.locator('[data-ui="inlineAnalysis"]') });
      const grouping = await analysisGroup.evaluate(el => {
        const source = [...el.querySelectorAll('[data-ui="sourceSentence"]')].at(-1);
        const panel = el.querySelector('[data-ui="inlineAnalysis"]');
        const sourceText = source.querySelector("[lang]");
        const lastVisible = [...panel.children]
          .filter(child => getComputedStyle(child).display !== "none")
          .at(-1);
        return {
          joined:
            source.closest('[data-ui="sourceUtterance"]') ===
            panel.closest('[data-ui="sourceUtterance"]'),
          gap: panel.getBoundingClientRect().top - source.getBoundingClientRect().bottom,
          alignment: Math.abs(
            panel.getBoundingClientRect().left - sourceText.getBoundingClientRect().left,
          ),
          separator: getComputedStyle(panel).borderTopWidth,
          background: getComputedStyle(el).backgroundColor,
          trailingSpace:
            panel.getBoundingClientRect().bottom - lastVisible.getBoundingClientRect().bottom,
        };
      });
      assert.equal(grouping.joined, true, "original and explanation share one utterance group");
      assert.ok(grouping.gap <= 4, "analysis follows its original without a detached gap");
      assert.ok(grouping.alignment <= 1, "analysis aligns with original text");
      assert.equal(grouping.separator, "0px", "no divider splits the source from its analysis");
      assert.notEqual(grouping.background, "rgba(0, 0, 0, 0)");
      assert.ok(
        grouping.trailingSpace <= 8,
        "no duplicate action or empty trailing section adds space",
      );
      await page.screenshot({ path: join(output, `analysis-${width}-${theme}.png`) });
      await reader.locator('[data-ui="inlineAnalysis"]').evaluate(el => {
        const stress = document.createElement("p");
        stress.id = "analysis-scroll-stress";
        stress.textContent = "完整教學說明。".repeat(500);
        el.append(stress);
      });
      await content.evaluate(el => {
        const row = el.querySelector('[data-ui="analysis-toggle"][aria-expanded="true"]');
        el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top + 80;
      });
      const toolbarBox = await reader.locator('[data-ui="dialogue-toolbar"]').boundingBox();
      const contentBox = await content.boundingBox();
      const pinnedSource = await analysisButton.locator("xpath=parent::*").boundingBox();
      assert.equal(
        toolbarBox.y,
        contentBox.y,
        "toolbar stays fully visible while reading analysis",
      );
      assert.equal(
        pinnedSource.y,
        toolbarBox.y + toolbarBox.height,
        "the compact source range stays below the toolbar",
      );
      await page.screenshot({ path: join(output, `pinned-${width}-${theme}.png`) });
      await reader.locator("#analysis-scroll-stress").evaluate(el => el.remove());
      await content.evaluate(el => {
        el.scrollTop = 0;
      });
      const fixedHeader = await header.boundingBox();
      const fixedPlayer = await player.boundingBox();
      await content.evaluate(el => {
        const spacer = document.createElement("div");
        spacer.id = "scroll-stress";
        spacer.style.height = "1200px";
        el.append(spacer);
        el.scrollTop = el.scrollHeight;
      });
      assert.ok(await content.evaluate(el => el.scrollTop > 0));
      await assertOuterFixed();
      assert.deepEqual(await header.boundingBox(), fixedHeader);
      assert.deepEqual(await player.boundingBox(), fixedPlayer);
      await content.evaluate(el => {
        el.querySelector("#scroll-stress").remove();
        el.scrollTop = 0;
      });
      // A stray in-flow node outside the app must not create a second scrollbar.
      await page.evaluate(() => {
        const spacer = document.createElement("div");
        spacer.id = "shell-scroll-stress";
        spacer.style.height = "16px";
        document.body.append(spacer);
      });
      await assertFits();
      await page.evaluate(() => document.getElementById("shell-scroll-stress").remove());
      if (width === 320 && theme === "light") {
        await page.setViewportSize({ width, height: 400 });
        await assertOuterFixed();
        assert.equal((await header.boundingBox()).y, 0);
        const shortPlayer = await player.boundingBox();
        assert.equal(shortPlayer.y + shortPlayer.height, 400, "player fits a short viewport");
        assert.ok((await content.boundingBox()).height > 0, "content can shrink below the header");
        await content.evaluate(el => {
          el.scrollTop = el.scrollHeight;
        });
        const area = await content.boundingBox();
        await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
        await page.mouse.wheel(0, 1000);
        await page.evaluate(
          () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        await assertOuterFixed();
        assert.deepEqual(
          await player.boundingBox(),
          shortPlayer,
          "wheel input cannot move the player",
        );
        await page.setViewportSize({ width, height: 800 });
        await content.evaluate(el => {
          el.scrollTop = 0;
        });
        await assertFits();
      }
      await reader.getByRole("button", { name: "播放這句 2", exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('[data-ui="player-scope"]')?.textContent.includes("目前選取的句子"),
      );
      assert.equal(await player.getByRole("button", { name: "上一句", exact: true }).count(), 1);
      // Whole-scene playback is directly available beside the dialogue heading.
      const wholeScene = reader
        .locator('[data-ui="dialogue-toolbar"]')
        .getByRole("button", { name: "播放完整對話", exact: true });
      await wholeScene.click();
      await page.waitForFunction(() =>
        document.querySelector('[data-ui="player-scope"]')?.textContent.includes("場景"),
      );
      for (const label of ["設定", "活動"]) {
        await reader.locator("#reader-options").click();
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.getByRole("dialog").waitFor();
        await page.locator('[data-slot="popover-content"]').waitFor({ state: "detached" });
        const sheetScroll = page.locator('[data-ui="sheet-scroll"]');
        const sheetHeader = page.locator('[data-ui="sheet-header"]');
        const fixedSheetHeader = await sheetHeader.boundingBox();
        assert.ok(
          await sheetScroll.evaluate(el => {
            const spacer = document.createElement("div");
            spacer.style.height = "1200px";
            el.append(spacer);
            el.scrollTop = el.scrollHeight;
            return el.scrollTop > 0;
          }),
          "overlay retains its own scroll region",
        );
        await assertOuterFixed();
        assert.deepEqual(await sheetHeader.boundingBox(), fixedSheetHeader);
        assert.equal(await page.locator('[id="page-panel-lessons"]').count(), 1);
        await page.getByRole("dialog").getByRole("button", { name: "關閉", exact: true }).focus();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => document.activeElement.id), "reader-options");
        await assertFits();
      }
      await reader.getByRole("button", { name: "回到內容庫", exact: true }).focus();
      await page.keyboard.press("Enter");
      await reader.waitFor({ state: "detached" });
      await page.locator('[data-ui="app-header"]').waitFor();
      assert.equal(await page.evaluate(() => document.activeElement.id), "page-nav-lessons");
      assert.deepEqual(errors, []);
      console.log(
        `PASS reader ${width}px ${theme}: fullscreen, compact controls, analysis, scroll, scopes, sheets, return focus`,
      );
      await page.close();
    }
  }
  const imported = await browser.newPage({
    viewport: { width: 320, height: 800 },
    reducedMotion: "reduce",
  });
  await imported.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html?readerImport");
  await imported.locator("#page-nav-lessons").click();
  await imported
    .locator("article")
    .filter({ hasText: "An original video" })
    .getByRole("button")
    .click();
  await imported.locator('[data-ui="unifiedReader"]').waitFor();
  assert.equal(await imported.locator('[data-ui="unifiedPlayer"]').count(), 0);
  await imported.locator("#reader-options").click();
  for (const label of ["設定", "活動"])
    assert.equal(await imported.getByRole("button", { name: label, exact: true }).count(), 1);
  await imported.getByRole("button", { name: "設定", exact: true }).click();
  await imported.getByRole("dialog").waitFor();
  await imported.locator('[data-slot="popover-content"]').waitFor({ state: "detached" });
  await imported.getByRole("dialog").getByRole("button", { name: "關閉", exact: true }).focus();
  await imported.keyboard.press("Escape");
  await imported.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await imported.evaluate(() => document.activeElement.id), "reader-options");
  console.log("PASS imported reader retains utility menu without video controls");
  await imported.close();
  for (const mode of ["long=ja", "cross"]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
    await page.goto(server.resolvedUrls.local[0] + `dev/reader-preview.html?v6&${mode}`);
    await page.locator('[data-ui="analysis-toggle"]').last().click();
    const analysis = page.locator('[data-ui="inlineAnalysis"]');
    await analysis.waitFor();
    assert.equal(await analysis.count(), 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await page
        .locator('[data-ui="sourceSentence"]')
        .evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth)),
      true,
    );
    if (mode === "long=ja") assert.ok(await page.locator("ruby").count());
    else
      assert.equal(
        await page.locator('[data-ui="analysis-toggle"][aria-expanded="false"]').count(),
        1,
        "cross-cue analysis stays shared",
      );
    await assertSourceAlignment(page);
    if (mode === "long=ja") {
      await page.locator("ruby").evaluateAll(els =>
        els.forEach(el => {
          el.style.rubyPosition = "under";
        }),
      );
      await assertSourceAlignment(page);
      await page.locator("ruby").evaluateAll(els =>
        els.forEach(el => {
          el.style.removeProperty("ruby-position");
        }),
      );
    }
    await page.screenshot({
      path: join(output, mode === "cross" ? "cross-cue.png" : "japanese.png"),
    });
    const toggles = page.locator('[data-ui="analysis-toggle"]');
    const all = page.locator('[data-ui="analysis-toggle-all"]');
    const count = await toggles.count();
    await all.focus();
    await page.keyboard.press("Enter");
    assert.equal(await analysis.count(), count, "bulk reading includes each analysis once");
    await page
      .locator('[data-ui="sourceSentence"]')
      .last()
      .click({ position: { x: 4, y: 8 } });
    assert.equal(
      await analysis.count(),
      count - 1,
      "a source-row click closes only its shared analysis",
    );
    await toggles.last().focus();
    await page.keyboard.press("Space");
    assert.equal(await analysis.count(), count);
    assert.equal(await toggles.last().getAttribute("aria-expanded"), "true");
    assert.equal(
      await toggles.last().evaluate(el => el === document.activeElement),
      true,
      "disclosure focus stays stable",
    );
    await all.click();
    assert.equal(await analysis.count(), 0);
    await toggles.first().focus();
    await page.keyboard.press("Enter");
    assert.equal(await analysis.count(), 1);
    await page
      .locator('[data-ui="sourceSentence"]')
      .first()
      .click({ position: { x: 4, y: 8 } });
    assert.equal(await analysis.count(), 0);
    await all.click();
    await page.screenshot({
      path: join(output, mode === "cross" ? "all-cross-cue.png" : "all-japanese.png"),
    });
    console.log(`PASS narrow reader ${mode}: ruby/wrapping and shared analysis`);
    await page.close();
  }
  for (const locale of ["en", "zh-CN", "ja", "ko"]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
    await page.goto(server.resolvedUrls.local[0] + `dev/reader-preview.html?v6&locale=${locale}`);
    const all = page.locator('[data-ui="analysis-toggle-all"]');
    await all.click();
    assert.equal(
      await page.locator('[data-ui="inlineAnalysis"]').count(),
      await page.locator('[data-ui="analysis-toggle"]').count(),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(
      await page
        .locator('[data-ui="dialogue-toolbar"]')
        .evaluate(el => el.scrollWidth <= el.clientWidth),
      true,
    );
    await page.screenshot({ path: join(output, `all-320-${locale}.png`) });
    await all.click();
    assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 0);
    console.log(`PASS narrow ${locale}: localized bulk controls and toolbar wrapping`);
    await page.close();
  }
  console.log("Reader screenshots:", output);
} finally {
  await browser?.close();
  await server.close();
}
