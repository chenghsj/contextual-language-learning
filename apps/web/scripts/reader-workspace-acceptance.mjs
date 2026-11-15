import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import { chromium } from "../../extension/node_modules/playwright/index.mjs";
import { mockYouTube } from "./fake-youtube.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const output =
  process.env.READER_WORKSPACE_OUTPUT ??
  fileURLToPath(new URL("../../../.audit/reader-boundary/", import.meta.url));
async function assertDesktopEdges(page) {
  const stage = await page.locator(".video-stage").boundingBox();
  const card = await page.locator('[data-ui="unifiedReader"]').boundingBox();
  const toolbar = await page.locator(".reading-toolbar").boundingBox();
  const grip = await page.getByRole("separator", { name: "調整教材欄寬度" }).boundingBox();
  assert.ok(Math.abs(stage.y - card.y) < 1, "video stage and material card top edges align");
  assert.ok(Math.abs(stage.x - toolbar.x) < 1, "video and page header left edges align");
  assert.ok(
    Math.abs(card.x + card.width - toolbar.x - toolbar.width) < 1,
    "card and header right edges align",
  );
  assert.ok(
    Math.abs(grip.x - stage.x - stage.width - (card.x - grip.x - grip.width)) < 1,
    "both sides of the separator have equal gutters",
  );
}
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "localhost", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const results = [];
  for (const [width, height] of process.env.READER_WORKSPACE_CASES
    ? JSON.parse(process.env.READER_WORKSPACE_CASES)
    : [
        [320, 844],
        [480, 900],
        [900, 1000],
        [1024, 768],
        [1165, 768],
        [1600, 900],
        [844, 390],
      ]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", error => {
        errors.push(error.message);
        console.log("PAGE ERROR", error.message);
      });
      const embeds = [];
      await mockYouTube(page, embeds);
      await page.route("https://www.youtube-nocookie.com/embed/**", route => {
        embeds.push({ url: route.request().url() });
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<html><body style="margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(140deg,#253c4b,#102027);color:#fff;font:20px system-ui"><div style="text-align:center"><div style="font-size:52px">▶</div>測試影片播放器<div style="font-size:13px;margin-top:16px;opacity:.7">Synthetic player · layout verification</div></div></body></html>`,
        });
      });
      await page.goto(server.resolvedUrls.local[0] + "?demo=1");
      const cards = page.locator(".cards > li");
      await cards.filter({ hasText: "完整情境教材" }).getByRole("button").click();
      const reader = page.locator('[data-ui="unifiedReader"]');
      await reader.waitFor();
      await reader.getByRole("combobox", { name: "直接選擇場景" }).waitFor();
      const themeControl = page.getByRole("combobox", { name: "外觀主題" });
      await themeControl.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const focus = await themeControl.evaluate(control => {
        const rect = control.getBoundingClientRect();
        const clips = [];
        for (let parent = control.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent),
            bounds = parent.getBoundingClientRect();
          if (style.overflowX !== "visible")
            clips.push({
              element: parent.tagName + "." + parent.className,
              left: rect.left - bounds.left,
              right: bounds.right - rect.right,
            });
        }
        return { visible: control.matches(":focus-visible"), clips, rect: rect.toJSON() };
      });
      assert.equal(focus.visible, true, "theme button retains visible keyboard focus");
      for (const clip of focus.clips)
        assert.ok(
          clip.left >= 2 && clip.right >= 2,
          `theme focus ring has space inside ${clip.element}: ${JSON.stringify(clip)}`,
        );
      await page.screenshot({
        path: join(output, `theme-focus-${width}-${theme}.png`),
        clip: {
          x: focus.rect.x - 4,
          y: focus.rect.y - 4,
          width: focus.rect.width + 8,
          height: focus.rect.height + 8,
        },
      });
      const address = page.url();
      assert.ok(address.includes("#/material/standard"));
      const video = page.locator('iframe[title^="YouTube 影片："]');
      const smallLandscape = width < 1024 && height <= 560;
      if (smallLandscape) {
        assert.equal(
          await video.isVisible(),
          false,
          "short landscape starts with readable material space",
        );
        await page.getByRole("button", { name: "顯示影片", exact: true }).click();
      }
      await video.waitFor();
      const frame = await video.boundingBox(),
        material = await page.locator(".video-reading-content").boundingBox();
      if (width >= 1024) {
        await assertDesktopEdges(page);
        await page.screenshot({
          path: join(output, `standard-${width}x${height}-${theme}.png`),
          animations: "disabled",
        });
        assert.ok(frame.width >= width * 0.5, "video occupies the large left area");
        assert.ok(material.x >= frame.x + frame.width, "material is to the right of the video");
        assert.ok(Math.abs(material.width - 400) <= 2, "material defaults to a 400px pane");
        const separator = page.getByRole("separator", { name: "調整教材欄寬度" });
        assert.equal(await separator.getAttribute("data-slot"), "resizable-handle");
        assert.equal(await page.locator('[data-slot="resizable-panel-group"]').count(), 1);
        await separator.focus();
        await separator.press("ArrowLeft");
        assert.ok(
          (await page.locator(".video-reading-content").boundingBox()).width > material.width,
        );
        await separator.hover();
        const beforeDrag = (await page.locator(".video-reading-content").boundingBox()).width;
        const grip = await separator.boundingBox();
        await page.mouse.down();
        await page.mouse.move(grip.x - 40, grip.y + grip.height / 2, { steps: 5 });
        await page.mouse.up();
        await page.waitForFunction(
          before =>
            document.querySelector(".video-reading-content").getBoundingClientRect().width >
            before + 20,
          beforeDrag,
        );
        assert.ok(
          (await page.locator(".video-reading-content").boundingBox()).width > beforeDrag + 20,
          "pointer drag changes material width",
        );
        await assertDesktopEdges(page);
        const storedWidth = Number(
          await page.evaluate(() => localStorage.getItem("cll-reader-pane-width")),
        );
        assert.ok(
          Math.abs(
            storedWidth - (await page.locator(".video-reading-content").boundingBox()).width,
          ) < 2,
        );
        const embedCount = embeds.length;
        await page.setViewportSize({ width: 900, height });
        await page.waitForFunction(
          () =>
            getComputedStyle(document.querySelector('[data-slot="resizable-panel-group"]'))
              .flexDirection === "column",
        );
        assert.equal(await separator.isVisible(), false, "mobile does not expose a resize handle");
        await page.setViewportSize({ width, height });
        await page.waitForFunction(
          expected =>
            Math.abs(
              document.querySelector(".video-reading-content").getBoundingClientRect().width -
                expected,
            ) < 2,
          storedWidth,
        );
        assert.equal(
          embeds.length,
          embedCount,
          "responsive transitions preserve the player iframe",
        );
        await separator.dblclick();
        await page.waitForFunction(
          () =>
            Math.abs(
              document.querySelector(".video-reading-content").getBoundingClientRect().width - 400,
            ) < 2,
        );
        assert.equal(
          await page.evaluate(() => Number(localStorage.getItem("cll-reader-pane-width"))),
          400,
          "double-click reset also updates the saved width",
        );
      } else {
        assert.ok(material.y >= frame.y + frame.height, "small screens stack material below video");
      }
      assert.ok(frame.width >= 200 && frame.height >= 200);
      await page.waitForFunction(() => !!window.syntheticPlayer);
      const embedsBefore = embeds.length;
      const player = reader.locator('[data-ui="unifiedPlayer"]');
      if (smallLandscape) await page.getByRole("button", { name: "收合影片", exact: true }).click();
      await player.getByRole("button", { name: "播放", exact: true }).click();
      if (!smallLandscape)
        await page.getByRole("button", { name: "收合影片", exact: true }).click();
      assert.equal(await video.isVisible(), false);
      const collapsed = await page.locator(".video-reading-content").boundingBox();
      assert.ok(collapsed.width >= width - 60, "collapsed video releases the reading width");
      assert.ok(collapsed.height >= 150, "short viewports retain usable material height");
      const collapsedCard = await reader.boundingBox();
      const collapsedToolbar = await page.locator(".reading-toolbar").boundingBox();
      assert.ok(
        Math.abs(collapsedCard.x - collapsedToolbar.x) < 1,
        "collapsed material and header left edges align",
      );
      assert.ok(
        Math.abs(
          collapsedCard.x + collapsedCard.width - collapsedToolbar.x - collapsedToolbar.width,
        ) < 1,
        "collapsed material and header right edges align",
      );
      if (width >= 1024)
        await page.screenshot({
          path: join(output, `collapsed-${width}x${height}-${theme}.png`),
          animations: "disabled",
        });
      await page.getByRole("button", { name: "顯示影片", exact: true }).click();
      await video.waitFor({ state: "visible" });
      assert.equal(embeds.length, embedsBefore, "collapse does not reload the video");
      assert.equal(
        await page.evaluate(() => window.syntheticPlayer.state),
        1,
        "collapse retains playback state",
      );
      if (smallLandscape) await page.getByRole("button", { name: "收合影片", exact: true }).click();
      const scroll = reader.locator('[data-ui="lessonContent"]');
      const standardScrollRange = await scroll.evaluate(
        node => node.scrollHeight - node.clientHeight,
      );
      if (standardScrollRange > 50) {
        await scroll.hover();
        await page.mouse.wheel(0, 420);
        await page.waitForFunction(
          () => (document.querySelector('[data-ui="lessonContent"]')?.scrollTop ?? 0) > 50,
        );
      }
      const y = await scroll.evaluate(node => node.scrollTop);
      await page.goBack();
      await cards.filter({ hasText: "完整情境教材" }).waitFor();
      await page.goForward();
      await reader.waitFor();
      assert.equal(page.url(), address);
      await page.waitForFunction(
        y => (document.querySelector('[data-ui="lessonContent"]')?.scrollTop ?? 0) >= y - 10,
        y,
      );
      await page.reload();
      await reader.waitFor();
      assert.equal(page.url(), address);
      await page.waitForFunction(
        y => (document.querySelector('[data-ui="lessonContent"]')?.scrollTop ?? 0) >= y - 10,
        y,
      );
      assert.equal(
        await page.evaluate(() => window.scrollY),
        0,
        "the material pane scrolls instead of the whole workspace",
      );
      await page.getByRole("button", { name: "返回內容庫", exact: true }).click();
      await cards.filter({ hasText: "雲端自訂筆記" }).getByRole("button").click();
      const article = page.getByRole("article", { name: "教材內容" });
      await article.waitFor();
      await page.getByRole("button", { name: "收藏此情境", exact: true }).click();
      await page.getByRole("button", { name: "取消收藏此情境", exact: true }).waitFor();
      const customAddress = page.url();
      const testCollapsedHistory = width === 1165 && theme === "light";
      if (testCollapsedHistory)
        await page.getByRole("button", { name: "收合影片", exact: true }).click();
      const pane = page.locator(".video-reading-content");
      await pane.hover();
      await page.mouse.wheel(0, 700);
      await page.waitForFunction(
        () => (document.querySelector(".video-reading-content")?.scrollTop ?? 0) > 100,
      );
      const customY = await pane.evaluate(node => node.scrollTop);
      await page.goBack();
      await cards.filter({ hasText: "雲端自訂筆記" }).waitFor();
      await page.goForward();
      await article.waitFor();
      assert.equal(page.url(), customAddress);
      if (testCollapsedHistory)
        assert.equal(
          await page.locator(".video-reading-layout").getAttribute("data-video-collapsed"),
          "true",
        );
      await page.waitForFunction(
        y => (document.querySelector(".video-reading-content")?.scrollTop ?? 0) >= y - 10,
        customY,
      );
      await page.reload();
      await article.waitFor();
      assert.equal(page.url(), customAddress);
      await page.waitForFunction(
        y => (document.querySelector(".video-reading-content")?.scrollTop ?? 0) >= y - 10,
        customY,
      );
      if (testCollapsedHistory) {
        assert.equal(
          await page.locator(".video-reading-layout").getAttribute("data-video-collapsed"),
          "true",
        );
        await page.getByRole("button", { name: "顯示影片", exact: true }).click();
      }
      await pane.hover();
      await page.mouse.wheel(0, -10000);
      await page.waitForFunction(
        () => (document.querySelector(".video-reading-content")?.scrollTop ?? 1) === 0,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.ok((await pane.boundingBox()).height >= 150);
      await page.screenshot({
        path: join(output, `workspace-${width}x${height}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      if (width === 1165 && theme === "light") {
        await page.goBack();
        await cards.filter({ hasText: "完整情境教材" }).waitFor();
        await page.getByRole("tab", { name: "收藏", exact: true }).click();
        await cards.filter({ hasText: "An original video" }).getByRole("button").click();
        await reader.waitFor();
        const favoriteAddress = page.url();
        assert.ok(favoriteAddress.includes("#/favorite/"));
        await page.goBack();
        await cards.filter({ hasText: "An original video" }).waitFor();
        assert.ok(page.url().endsWith("#/favorites"));
        await page.goForward();
        await reader.waitFor();
        assert.equal(page.url(), favoriteAddress);
        await page.reload();
        await reader.waitFor();
        assert.equal(page.url(), favoriteAddress, "favorite links survive reload too");
      }
      assert.deepEqual(errors, []);
      results.push({
        width,
        height,
        theme,
        largeVideoLeft: width >= 1024,
        resizable: width >= 1024,
        stacked: width < 1024,
        history: true,
        reload: true,
        scrollRestoration: true,
        standardScrollRange,
        collapsePreservesPlayback: true,
        favorite: true,
      });
      console.log(
        `PASS workspace ${width}x${height} ${theme}: layout, resize, playback, favorites, back/forward/reload and scroll`,
      );
      await context.close();
    }
  }
  await writeFile(join(output, "workspace-results.json"), JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
