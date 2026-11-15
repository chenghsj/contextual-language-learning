import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("..", import.meta.url)),
  output = await mkdtemp(join(tmpdir(), "cll-v6-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5189, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 390, 1000, 1280])
    for (const mode of ["normal", "cross", "gaps"]) {
      const cross = mode === "cross",
        gaps = mode === "gaps";
      const page = await browser.newPage({ viewport: { width, height: 800 } }),
        errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(
        `http://127.0.0.1:5189/dev/reader-preview.html?v6&wide${cross ? "&cross" : gaps ? "&gaps" : ""}`,
      );
      await page.locator('[data-ui="analysis-toggle"]').first().waitFor();
      await page.locator('[data-ui="analysis-toggle"]').first().click();
      let analysis = page.locator('[data-ui="inlineAnalysis"]');
      assert.equal(await analysis.count(), 1);
      if (gaps) assert.equal(await page.locator('[data-ui="pronunciationMissing"]').count(), 1);
      assert.equal(
        await analysis.getByRole("button", { name: "AI 延伸例句", exact: true }).count(),
        0,
        "basic-only utterance has no examples entry",
      );
      await page.locator('[data-ui="analysis-toggle"][aria-expanded="true"]').click();
      await page.locator('[data-ui="analysis-toggle"]').last().click();
      analysis = page.locator('[data-ui="inlineAnalysis"]');
      assert.equal(await analysis.getByText("when 連接兩件事的時間", { exact: true }).count(), 1);
      if (cross) {
        assert.equal(
          await page.locator('[data-ui="analysis-toggle"][aria-expanded="false"]').count(),
          1,
          "only the basic first utterance remains collapsed; the cross-caption utterance shares one analysis",
        );
        assert.ok(await page.locator('[data-ui="source-chunk-hover"]').count());
        assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 1);
        assert.ok(
          await page
            .locator('[data-ui="selectedChunkMeaning"]')
            .getByText("正要做某事，這時另一件事發生。", { exact: true })
            .isVisible(),
        );
      }
      const play = page.getByRole("button", { name: `播放這句 ${cross ? 3 : 2}`, exact: true });
      await play.click();
      assert.equal(await play.getAttribute("aria-pressed"), "true");
      assert.equal(
        await page.locator('[data-ui="inlineAnalysis"]').count(),
        1,
        "playback retains open analysis",
      );
      const translation = page.getByRole("button", { name: "顯示翻譯", exact: true });
      await translation.click();
      assert.equal(
        await page
          .getByRole("button", { name: "隱藏翻譯", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await page.locator('[data-ui="inlineAnalysis"]').count(),
        1,
        "translation retains open analysis",
      );
      await analysis.getByRole("button", { name: "AI 延伸例句", exact: true }).click();
      assert.ok(await analysis.getByText("Are we ready?", { exact: true }).isVisible());
      assert.ok(await analysis.getByText("Shall we head out now?", { exact: true }).isVisible());
      assert.equal(
        await analysis.getByRole("button", { name: "本影片其他出現", exact: true }).count(),
        0,
        "no occurrences entry when saved subtitles contain no other matches",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        "no horizontal overflow",
      );
      await page.screenshot({
        path: join(output, `reader-${width}${cross ? "-cross" : gaps ? "-gaps" : ""}.png`),
        fullPage: true,
      });
      if (gaps) {
        await analysis.getByRole("button", { name: "AI 延伸例句", exact: true }).click();
        assert.equal(await page.locator('[data-ui="pronunciationMissing"]').count(), 2);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  for (const width of [320, 390, 1000, 1280])
    for (const layout of ["side", "wide"])
      for (const language of ["ja", "ko"]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        await page.goto(
          `http://127.0.0.1:5189/dev/reader-preview.html?v6&long=${language}${layout === "wide" ? "&wide" : ""}`,
        );
        await page.locator('[data-ui="analysis-toggle"]').first().press("Enter");
        assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 1);
        await page.locator('[data-ui="analysis-toggle"]').last().press("Enter");
        assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 2);
        assert.ok(await page.locator('[data-ui="source-chunk-hover"]').count());
        await page.locator('[data-ui="sentence-number"]').last().click();
        assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 2);
        assert.ok(
          await page
            .locator('[data-ui="selectedChunkMeaning"]')
            .getByText("再一起討論並決定具體計畫。", { exact: true })
            .isVisible(),
        );
        assert.equal(await page.getByRole("button", { name: "更多解說", exact: true }).count(), 0);
        assert.equal(
          await page.getByRole("button", { name: "AI 延伸例句", exact: true }).count(),
          0,
        );
        const play = page.getByRole("button", { name: "播放這句 2", exact: true });
        await play.scrollIntoViewIfNeeded();
        const scrollBefore = await page
          .locator('[data-ui="lessonContent"]')
          .evaluate(e => e.scrollTop);
        await play.click();
        assert.equal(
          await page.locator('[data-ui="lessonContent"]').evaluate(e => e.scrollTop),
          scrollBefore,
          "playback does not scroll reading",
        );
        assert.equal(await page.locator('[data-ui="inlineAnalysis"]').count(), 2);
        await page.getByRole("button", { name: "發音標註", exact: true }).click();
        await page.getByRole("radio", { name: "關閉", exact: true }).click();
        await page.keyboard.press("Escape");
        await page.getByRole("radio", { name: "關閉", exact: true }).waitFor({ state: "hidden" });
        assert.equal(
          await page.locator('[data-ui="inlineAnalysis"]').count(),
          2,
          "reading toggle keeps analysis",
        );
        await page.getByRole("button", { name: "發音標註", exact: true }).click();
        await page
          .getByRole("radio", { name: language === "ja" ? "假名" : "實際讀音", exact: true })
          .click();
        await page.keyboard.press("Escape");
        await page.getByRole("radio", { name: "關閉", exact: true }).waitFor({ state: "hidden" });
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          "long source/readings do not overflow",
        );
        await page.screenshot({
          path: join(output, `reader-${width}-${layout}-${language}.png`),
          fullPage: true,
        });
        await page.close();
      }
  for (const width of [320, 390, 1000, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto("http://127.0.0.1:5189/dev/redesign-preview.html?providers=1");
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await page.locator("#learning-level").waitFor();
    assert.equal(await page.locator("#contextual-examples").count(), 0);
    assert.equal(await page.locator('[aria-label="解說偏好"]').count(), 0);
    await page.screenshot({ path: join(output, `settings-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "進階教材設定", exact: true }).click();
    await page.locator("#learning-explanation-language").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "進階教材設定", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    await page.waitForFunction(() => {
      const field = document.querySelector("#learning-explanation-language");
      const rect = field?.getBoundingClientRect();
      if (!field || !rect || rect.height < 20) return false;
      const hit = document.elementFromPoint(
        (rect.left + rect.right) / 2,
        (rect.top + rect.bottom) / 2,
      );
      return hit === field || field.contains(hit);
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "simplified settings do not overflow",
    );
    await page.screenshot({ path: join(output, `settings-${width}-advanced.png`), fullPage: true });
    await page.close();
  }
  console.log(
    JSON.stringify({
      result: "passed",
      widths: [320, 390, 1000, 1280],
      crossCaptionUtteranceAndDiscontinuousChunk: true,
      readingGapWarnings: true,
      longJapaneseAndKoreanReadings: true,
      simplifiedSettingsActualApp: true,
      keyboardFocusAndSelection: true,
      layouts: ["side", "wide"],
      artifacts: output,
      playback: "preview adapter only; not real video",
      nativeHost: "separate acceptance",
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
