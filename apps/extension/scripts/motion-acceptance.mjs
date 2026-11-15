import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

// Actual App/CSS with an isolated, simulated Host. No user storage or real video calls.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(root, "../../docs/quality/ui-motion");
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
const results = [];
let browser;
const settle = page =>
  page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(a => a.effect?.getTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => {})),
    );
  });
const mode = (page, expected) =>
  page.waitForFunction(value => document.documentElement.dataset.motion === value, expected);
async function general(page) {
  await page.locator("#header-settings").click();
  await settle(page);
  await page.getByRole("button", { name: /^一般 / }).click();
  await settle(page);
}
async function choice(page, reduced) {
  const toggle = page.getByRole("switch", { name: "減少動態效果", exact: true });
  if ((await toggle.isChecked()) !== reduced) await toggle.click();
}
async function contentMotion(page, selector) {
  return page.locator(selector).evaluate(el =>
    el.getAnimations().map(a => ({
      duration: a.effect.getTiming().duration,
      frames: a.effect.getKeyframes().map(k => ({ opacity: k.opacity, transform: k.transform })),
    })),
  );
}
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const system of ["no-preference", "reduce"]) {
    for (const preference of ["full", "reduced", "system"]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 760 },
        reducedMotion: system,
      });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const expected = preference === "system" ? "full" : preference;
      await page.goto(`${base}dev/redesign-preview.html?motion=${preference}`);
      await mode(page, expected);
      await page.locator("#header-settings").click();
      const sheet = await page.locator('[data-slot="sheet-content"]').evaluate(el => ({
        name: getComputedStyle(el).animationName,
        duration: getComputedStyle(el).animationDuration,
      }));
      assert.equal(sheet.name, expected === "full" ? "enter" : "none");
      if (expected === "full") assert.equal(sheet.duration, "0.32s");
      await settle(page);
      const headerBefore = await page.locator('[data-ui="sheet-header"]').boundingBox();
      await page.getByRole("button", { name: /^一般 / }).click();
      const navigation = await contentMotion(page, '[data-ui="sheet-scroll"]');
      assert.equal(navigation.length > 0, expected === "full");
      if (expected === "full") {
        assert.equal(navigation[0].frames[0].transform, "translateX(12px)");
        assert.equal(navigation[0].duration, 280);
      }
      await settle(page);
      assert.deepEqual(await page.locator('[data-ui="sheet-header"]').boundingBox(), headerBefore);
      const toggle = page.getByRole("switch", { name: "減少動態效果", exact: true });
      assert.ok(await toggle.getAttribute("aria-describedby"));
      assert.equal(await toggle.isChecked(), expected === "reduced");
      assert.equal(await page.getByRole("combobox", { name: "動畫效果" }).count(), 0);
      await page.emulateMedia({ reducedMotion: system === "reduce" ? "no-preference" : "reduce" });
      const afterSystemChange = expected;
      await mode(page, afterSystemChange);
      assert.equal(
        (await contentMotion(page, '[data-ui="sheet-scroll"]')).length,
        0,
        "system changes do not replay navigation",
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      if (preference === "system" && system === "no-preference")
        await page.screenshot({ path: join(output, "motion-preference-390.png") });
      results.push({ system, preference, expected, sheet, navigation, afterSystemChange });
      console.log("PASS motion preference", system, preference);
      assert.deepEqual(errors, []);
      await page.close();
    }
  }

  const dialogPage = await browser.newPage({
    viewport: { width: 320, height: 560 },
    reducedMotion: "reduce",
  });
  await dialogPage.goto(`${base}dev/redesign-preview.html?motion=reduced`);
  await dialogPage
    .getByRole("button", { name: /^設定說明：/ })
    .first()
    .click();
  const reducedPopover = await dialogPage
    .locator('[data-slot="popover-content"]')
    .evaluate(el => ({ duration: getComputedStyle(el).animationDuration }));
  assert.ok(parseFloat(reducedPopover.duration) <= 0.001);
  await dialogPage.keyboard.press("Escape");
  await dialogPage.getByRole("button", { name: "預覽字幕", exact: true }).click();
  await dialogPage
    .locator('[data-ui="subtitle-editor"]')
    .getByRole("button", { name: "修改", exact: true })
    .first()
    .click();
  const dialogPlacement = await dialogPage.getByRole("dialog").evaluate(el => {
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      animation: getComputedStyle(el).animationName,
    };
  });
  assert.ok(dialogPlacement.x >= 0 && dialogPlacement.x + dialogPlacement.width <= 321);
  assert.ok(dialogPlacement.y >= 0 && dialogPlacement.y + dialogPlacement.height <= 561);
  assert.equal(dialogPlacement.animation, "none");
  results.push({ reducedDialog: dialogPlacement });
  await dialogPage.screenshot({ path: join(output, "reduced-dialog-320.png") });
  await dialogPage.getByRole("dialog").getByRole("button", { name: "完成", exact: true }).click();
  await dialogPage.getByRole("dialog").waitFor({ state: "detached" });
  await dialogPage.close();

  // Real selection, persistence, persistent write failure rollback and rapid navigation.
  const page = await browser.newPage({
    viewport: { width: 320, height: 560 },
    reducedMotion: "no-preference",
  });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${base}dev/redesign-preview.html?motionAcceptance=1&motion=full&motionScenes=1`);
  await general(page);
  await choice(page, true);
  await mode(page, "reduced");
  await page.waitForFunction(
    async () =>
      (await chrome.storage.local.get("preferencesV2")).preferencesV2.motionPreference ===
      "reduced",
  );
  await page.reload();
  await mode(page, "reduced");
  await general(page);
  await page.evaluate(() => {
    window.acceptance.failPreferenceWrites = true;
  });
  await choice(page, false);
  await page
    .getByText("Preview preference write failed", { exact: false })
    .waitFor({ state: "attached" });
  await mode(page, "reduced");
  await page.waitForTimeout(250);
  assert.equal(
    await page.evaluate(() => window.acceptance.preferenceWriteFailures),
    1,
    "rollback must not create a write retry loop",
  );
  assert.equal(await page.getByRole("switch", { name: "減少動態效果" }).isChecked(), true);
  await page.getByRole("button", { name: "關閉通知", exact: true }).click();
  await page.locator("[data-sonner-toast]").waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.acceptance.failPreferenceWrites = false;
  });
  await choice(page, false);
  await mode(page, "full");
  await page.getByRole("button", { name: "設定", exact: true }).dispatchEvent("click");
  await page.getByRole("button", { name: /^AI 與模型/ }).dispatchEvent("click");
  await page.getByRole("button", { name: "設定", exact: true }).dispatchEvent("click");
  await page.getByRole("button", { name: /^一般 / }).dispatchEvent("click");
  await settle(page);
  assert.ok(await page.getByRole("switch", { name: "減少動態效果" }).isVisible());
  await page.screenshot({ path: join(output, "motion-preference-320.png") });
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.id === "header-settings");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: "Prompt", exact: true });
  await prompt.fill("Unsaved motion acceptance draft");
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "上一步", exact: true }).click();
  assert.equal(await prompt.inputValue(), "Unsaved motion acceptance draft");
  await page.locator("#page-nav-lessons").click();
  await page
    .getByRole("article")
    .filter({ hasText: "An original video" })
    .getByRole("button")
    .click();
  const reader = page.locator('[data-ui="unifiedReader"]');
  await reader.waitFor();
  await settle(page);
  const playerBox = await reader.locator('[data-ui="unifiedPlayer"]').boundingBox();
  const headerBox = await reader.locator('[data-ui="reader-header"]').boundingBox();
  const controls = reader.locator('[data-ui="reader-header"]');
  await controls.getByRole("button", { name: "下一場景", exact: true }).click();
  const scene = await contentMotion(page, '[data-ui="lessonContent"]>div');
  assert.equal(scene[0]?.duration, 240);
  assert.deepEqual(await reader.locator('[data-ui="unifiedPlayer"]').boundingBox(), playerBox);
  assert.deepEqual(await reader.locator('[data-ui="reader-header"]').boundingBox(), headerBox);
  await settle(page);
  await reader.locator('[data-ui="analysis-toggle"][aria-expanded="false"]').first().click();
  await reader.getByRole("button", { name: "AI 延伸例句", exact: true }).click();
  const accordion = await reader
    .locator('[data-slot="accordion-content"][data-state="open"]')
    .evaluate(el => ({
      name: getComputedStyle(el).animationName,
      duration: getComputedStyle(el).animationDuration,
    }));
  assert.equal(accordion.name, "app-accordion-down");
  assert.equal(accordion.duration, "0.18s");
  await settle(page);
  await reader.getByRole("button", { name: "發音標註", exact: true }).click();
  const popover = await page.locator('[data-slot="popover-content"]').evaluate(el => ({
    name: getComputedStyle(el).animationName,
    duration: getComputedStyle(el).animationDuration,
  }));
  assert.equal(popover.name, "enter");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  results.push({
    persistence: "reduced survives reload",
    rollback: "one failure, committed choice restored",
    draft: "preserved",
    scene,
    accordion,
    popover,
    reducedPopover,
  });
  assert.deepEqual(errors, []);
  await page.close();

  // Container limits, short viewport, dark UI and reduced-mode portal placement.
  for (const [width, height, theme, preference, locale = "zh-TW"] of [
    [555, 760, "light", "full"],
    [900, 760, "dark", "full"],
    [320, 320, "dark", "reduced"],
    [320, 560, "dark", "reduced", "ja"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(
      `${base}dev/redesign-preview.html?motion=${preference}&theme=${theme}&locale=${locale}`,
    );
    await general(page);
    const metrics = await page.locator('[data-slot="sheet-content"]').evaluate(el => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        overflow: el.scrollWidth > el.clientWidth,
      };
    });
    assert.equal(metrics.width, Math.min(width, 400));
    assert.equal(metrics.height, height);
    assert.equal(metrics.overflow, false);
    const toggle = page.locator("#motion-preference");
    assert.equal(await toggle.getAttribute("role"), "switch");
    await toggle.focus();
    await page.keyboard.press("Space");
    await mode(page, preference === "reduced" ? "full" : "reduced");
    await page.keyboard.press("Space");
    await mode(page, preference);
    await page.screenshot({
      path: join(output, `settings-${width}-${height}-${theme}-${locale}.png`),
    });
    results.push({ viewport: { width, height }, preference, theme, locale, metrics });
    await page.close();
  }
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(
    "PASS switch states under both system preferences, legacy migration, keyboard, persistence, failed-write rollback, interruption, draft, scene/player and responsive portals.",
  );
  console.log("Evidence:", output);
} finally {
  await browser?.close();
  await server.close();
}
