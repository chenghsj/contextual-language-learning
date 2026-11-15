import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Actual editors and pointer/keyboard events; isolated mock video and Host.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.env.TIMING_LAYOUT_OUTPUT ?? "/tmp/cll-timing-range-layout";
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
const measurements = [];

async function reachable(page, footer, height) {
  const box = await footer.boundingBox();
  assert.ok(box.y >= 0 && box.y + box.height <= height + 1, "confirmation remains visible");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await footer.evaluate(el => el.scrollWidth <= el.clientWidth), true);
}
async function drag(page, slider, dx, grabOffset = 0) {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  const originX = box.x + box.width / 2 + grabOffset;
  await page.mouse.move(originX, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(originX + dx, box.y + box.height / 2, { steps: 8 });
  const released = await slider.evaluate(el => ({
    left: el.getBoundingClientRect().left,
    ruler: [...el.parentElement.nextElementSibling.children].map(item => item.textContent),
  }));
  await page.mouse.up();
  const settled = await slider.evaluate(el => ({
    left: el.getBoundingClientRect().left,
    ruler: [...el.parentElement.nextElementSibling.children].map(item => item.textContent),
  }));
  assert.deepEqual(
    settled,
    released,
    "releasing the handle must not change its position or time scale",
  );
}

try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const [width, height, theme, locale, scale] of [
    [320, 800, "light", "zh-TW", 1],
    [390, 800, "light", "zh-TW", 1],
    [555, 800, "light", "en", 1],
    [900, 800, "dark", "zh-TW", 1],
    [390, 320, "light", "zh-TW", 1],
    [640, 640, "light", "ja", 2],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}dev/reader-preview.html?wide&speech=mock&locale=${locale}`);
    await page.locator("#reader-options").click();
    await page
      .getByRole("button", {
        name: locale === "en" ? "Adjust timing" : locale === "ja" ? "時刻を調整" : "調整時間",
        exact: true,
      })
      .click();
    const editor = page.locator('[data-ui="reader-timing-editor"]');
    await editor.waitFor();
    await page.evaluate(
      ({ theme, scale }) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.style.fontSize = `${16 * scale}px`;
      },
      { theme, scale },
    );
    const sliders = editor.getByRole("slider");
    const initial = Number(await sliders.first().getAttribute("aria-valuenow"));
    await drag(page, sliders.first(), 0, 10);
    assert.equal(
      Number(await sliders.first().getAttribute("aria-valuenow")),
      initial,
      "grabbing the handle edge must not move it",
    );
    await drag(page, sliders.first(), 20);
    assert.notEqual(
      Number(await sliders.first().getAttribute("aria-valuenow")),
      initial,
      "drag changes the boundary",
    );
    const end = Number(await sliders.last().getAttribute("aria-valuenow"));
    await drag(page, sliders.last(), -10000);
    assert.ok(
      Number(await sliders.last().getAttribute("aria-valuenow")) -
        Number(await sliders.first().getAttribute("aria-valuenow")) >=
        0.2499,
      "handles cannot cross",
    );
    const inputs = editor.getByRole("textbox");
    await inputs.last().fill("00:08.000");
    await inputs.first().fill("00:01.234");
    await inputs.last().focus();
    assert.equal(Number(await sliders.first().getAttribute("aria-valuenow")), 1.234);
    await sliders.first().press("ArrowRight");
    assert.equal(
      Number(await sliders.first().getAttribute("aria-valuenow")),
      1.334,
      "keyboard keeps source millisecond precision",
    );
    await inputs.first().press("Shift+ArrowUp");
    await page.waitForFunction(
      () => document.querySelector('[data-ui="reader-timing-editor"] input').value === "00:02.3",
    );
    assert.equal(
      await inputs.first().inputValue(),
      "00:02.3",
      "focused input reflects keyboard nudges",
    );
    const footer = page.locator('[data-ui="timing-footer"]');
    await reachable(page, footer, height);
    await inputs.first().fill("invalid");
    assert.equal(await footer.locator("button").last().isDisabled(), true);
    await inputs.first().fill("00:01.334");
    await inputs.last().focus();
    await editor.locator('[data-ui="timing-fit-range"]').click();
    await editor.evaluate(el => el.closest('[data-ui="lessonContent"]').scrollTo(0, 0));
    await page.screenshot({
      path: join(output, `reader-${width}-${height}-${locale}-${theme}-${scale}.png`),
    });
    measurements.push({
      surface: "reader",
      width,
      height,
      locale,
      scale,
      footer: await footer.boundingBox(),
      originalEnd: end,
    });
    await footer.locator("button").last().click();
    await editor.waitFor({ state: "detached" });
    await page.locator("#reader-options").click();
    await page
      .getByRole("button", {
        name: locale === "en" ? "Adjust timing" : locale === "ja" ? "時刻を調整" : "調整時間",
        exact: true,
      })
      .click();
    await editor.waitFor();
    assert.equal(
      Number(await editor.getByRole("slider").first().getAttribute("aria-valuenow")),
      1.334,
      "save survives reopening",
    );
    await page.close();

    const subtitle = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    subtitle.on("pageerror", error => errors.push(error.message));
    await subtitle.goto(
      `${base}dev/redesign-preview.html?captions=early-ending&theme=${theme}${locale === "ja" ? "&locale=ja" : ""}`,
    );
    await subtitle.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await subtitle.evaluate(() => {
      const original = chrome.tabs.sendMessage;
      window.timingCalls = [];
      window.timingState = { currentMs: 2669, playing: false };
      chrome.tabs.sendMessage = async (id, message) => {
        window.timingCalls.push(message);
        if (message.type === "PLAYBACK_STATUS_GET")
          return { ok: true, durationMs: 30000, ...window.timingState };
        if (message.type === "LOOP_SET")
          window.timingState = { currentMs: message.startMs, playing: true };
        if (message.type === "PLAYBACK_PAUSE") window.timingState.playing = false;
        return original(id, message);
      };
    });
    await subtitle
      .getByRole("button", { name: locale === "ja" ? "字幕をプレビュー" : "預覽字幕", exact: true })
      .click();
    await subtitle
      .locator('[data-ui="subtitle-editor"] li')
      .first()
      .getByRole("button")
      .last()
      .click();
    const dialog = subtitle.locator('[data-ui="subtitle-edit-dialog"]');
    await dialog.waitFor();
    assert.equal(
      await dialog.locator("textarea").evaluate(el => el === document.activeElement),
      true,
      "editing begins in subtitle text",
    );
    await subtitle.evaluate(scale => {
      document.documentElement.style.fontSize = `${16 * scale}px`;
    }, scale);
    const fields = dialog.locator('[data-ui="timing-boundary"] input');
    await fields.last().fill("00:04.921");
    await fields.first().fill("00:02.669");
    await fields.last().focus();
    await dialog.locator('[data-ui="timing-fit-range"]').click();
    const handles = dialog.getByRole("slider");
    await handles.first().press("ArrowRight");
    assert.equal(Number(await handles.first().getAttribute("aria-valuenow")), 2.769);
    const seeksBefore = await subtitle.evaluate(
      () => window.timingCalls.filter(message => message.type === "YOUTUBE_SEEK").length,
    );
    await drag(subtitle, handles.first(), -10);
    assert.notEqual(Number(await handles.first().getAttribute("aria-valuenow")), 2.769);
    assert.equal(
      await subtitle.evaluate(
        () => window.timingCalls.filter(message => message.type === "YOUTUBE_SEEK").length,
      ),
      seeksBefore,
      "range dragging must not seek the video",
    );
    await fields.first().fill("00:02.669");
    await fields.last().focus();
    const confirm = dialog.locator('[data-ui="subtitle-edit-footer"]');
    await reachable(subtitle, confirm, height);
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await dialog.locator('[data-ui="subtitle-edit-body"]').evaluate(el => el.scrollTo(0, 0));
    await subtitle.screenshot({
      path: join(output, `subtitle-${width}-${height}-${locale}-${theme}-${scale}.png`),
    });
    if (width === 390 && height === 800) {
      await dialog
        .locator('[data-ui="timing-range-timeline"]')
        .screenshot({ path: join(output, "range-control.png") });
    }
    measurements.push({
      surface: "subtitle",
      width,
      height,
      locale,
      scale,
      footer: await confirm.boundingBox(),
    });
    assert.deepEqual(errors, []);
    await subtitle.close();
    console.log(
      `PASS draggable range, precise keyboard/input, save, reachable actions: ${width}×${height} ${locale} ${theme} scale=${scale}`,
    );
  }
  console.log(JSON.stringify({ output, measurements }));
} finally {
  await browser?.close();
  await server.close();
}
