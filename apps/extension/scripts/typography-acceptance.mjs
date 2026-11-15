// Real extension components; all accounts, generation and native services are fixtures.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-typography-ui-"));
console.log(JSON.stringify({ output }));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
const scenarios = [
  { width: 320, height: 800, theme: "light" },
  { width: 390, height: 800, theme: "dark" },
  { width: 555, height: 800, theme: "light" },
  { width: 900, height: 850, theme: "dark" },
  { width: 555, height: 320, theme: "light" },
  // Increase the root font to exercise rem scaling, independently of browser zoom.
  { width: 900, height: 850, theme: "light", fontScale: 2 },
];
const evidence = [];
const start = Number(process.env.TYPOGRAPHY_CASE_START || 0);
const cases = scenarios.slice(start, start + Number(process.env.TYPOGRAPHY_CASES || Infinity));
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const scenario of cases) {
    const { width, height, theme, fontScale = 1 } = scenario;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const key = `${width}-${height}-${theme}-${fontScale}`;
    async function open(path) {
      const url = new URL(path, server.resolvedUrls.local[0]);
      url.searchParams.set("motion", "reduced");
      await page.goto(url.href);
      await page.evaluate(
        ({ theme, fontScale }) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
          document.documentElement.dataset.motion = "reduced";
          document.documentElement.style.fontSize = `${16 * fontScale}px`;
        },
        { theme, fontScale },
      );
    }
    async function audit(surface) {
      await page.evaluate(() => {
        for (const animation of document.getAnimations())
          if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      });
      const result = await page.evaluate(fontScale => {
        const expected = { body: 14, source: 15, heading: 14, label: 12, meta: 11 };
        const failures = [],
          counts = {};
        for (const [role, size] of Object.entries(expected)) {
          const nodes = [...document.querySelectorAll(`.text-ui-${role}`)].filter(
            el => el.getClientRects().length,
          );
          counts[role] = nodes.length;
          for (const el of nodes) {
            const style = getComputedStyle(el);
            if (parseFloat(style.fontSize) !== size * fontScale)
              failures.push({ role, size: style.fontSize, text: el.textContent.slice(0, 70) });
            if (
              role === "heading" &&
              el.classList.contains("font-semibold") &&
              style.fontWeight !== "600"
            )
              failures.push({ role, weight: style.fontWeight, text: el.textContent.slice(0, 70) });
          }
        }
        for (const el of document.querySelectorAll('p[role="alert"], p.text-destructive')) {
          if (
            el.getClientRects().length &&
            parseFloat(getComputedStyle(el).fontSize) !== 14 * fontScale
          )
            failures.push({
              role: "error",
              size: getComputedStyle(el).fontSize,
              text: el.textContent.slice(0, 70),
            });
        }
        const overflow = [
          ...document.querySelectorAll(
            '[data-ui="create-scroll"], [data-ui="lessonContent"], [data-slot="sheet-content"], [data-ui="customReader"]',
          ),
        ]
          .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1)
          .map(el => ({
            ui: el.dataset.ui || el.dataset.slot,
            width: el.clientWidth,
            scroll: el.scrollWidth,
          }));
        return {
          counts,
          failures,
          overflow,
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      }, fontScale);
      if (result.overflow.length || result.failures.length || result.pageOverflow) {
        const details = await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter(
              el => el.getClientRects().length && el.getBoundingClientRect().right > innerWidth + 1,
            )
            .map(el => ({
              tag: el.tagName,
              text: el.textContent.slice(0, 80),
              className: el.getAttribute("class"),
            }))
            .slice(0, 25),
        );
        await writeFile(
          join(output, `failure-${surface}-${key}.json`),
          JSON.stringify({ result, details }, null, 2),
        );
        await page.screenshot({
          animations: "disabled",
          path: join(output, `failure-${surface}-${key}.png`),
        });
      }
      assert.deepEqual(result.failures, [], `${key} ${surface}: typography`);
      assert.deepEqual(result.overflow, [], `${key} ${surface}: inner overflow`);
      assert.equal(result.pageOverflow, false, `${key} ${surface}: page overflow`);
      await page.screenshot({
        animations: "disabled",
        path: join(output, `${surface}-${key}.png`),
      });
      evidence.push({ ...scenario, fontScale, surface, ...result });
    }

    await open(`dev/redesign-preview.html?providers=1&customModels=1&theme=${theme}`);
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await audit("create-video");
    await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
    const editor = page.locator('[data-ui="subtitle-editor"]');
    await editor.waitFor();
    await audit("subtitles");
    await editor.getByRole("button", { name: "修改", exact: true }).first().click();
    await page.getByRole("dialog").waitFor();
    await audit("subtitle-dialog");
    await page.keyboard.press("Escape");
    await editor.getByRole("button", { name: "返回影片", exact: true }).click();
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await audit("create-settings");
    await page.getByRole("tab", { name: "自訂 Markdown", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Prompt", exact: true })
      .fill("Typography acceptance fixture.");
    await page.getByRole("button", { name: "新增範本", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await audit("template-dialog");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await audit("create-confirm");
    await page.locator("#header-settings").click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await sheet.waitFor();
    await audit("settings-home");
    for (const [label, name] of [
      ["一般", "general"],
      ["教材與備份", "storage"],
      ["本機服務", "host"],
      ["AI 與模型", "ai"],
    ]) {
      await sheet.getByRole("button", { name: new RegExp(`^${label}`) }).click();
      if (name === "host") {
        await sheet.getByRole("button", { name: "檢查連線", exact: true }).click();
        await page.waitForFunction(() => {
          const button = document.querySelector('[data-ui="host-check-button"]');
          return button && !button.disabled;
        });
      }
      if (name === "ai") {
        await sheet.getByRole("button", { name: "進階設定", exact: true }).click();
        const input = sheet.getByLabel("模型 ID", { exact: true });
        await input.fill("Invalid Model Name");
        await input.press("Enter");
        await sheet.getByRole("alert").filter({ hasText: "不含空白" }).waitFor();
      }
      await audit(`settings-${name}`);
      await sheet.getByRole("button", { name: "設定", exact: true }).click();
    }
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    await page.locator("#header-activity").click();
    await sheet.waitFor();
    await audit("activity-sheet");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    await page
      .locator("#page-panel-create")
      .getByRole("button", { name: "建立內容", exact: true })
      .click();
    await page.waitForFunction(() => window.acceptance.docs.size > 0);
    await page
      .locator("[data-sonner-toast]")
      .getByRole("button", { name: "開啟教材", exact: true })
      .last()
      .click();
    await page.locator('[data-ui="customReader"]').waitFor();
    await audit("custom-reader");
    const markdown = page.locator('[data-ui="custom-markdown"]');
    assert.equal(
      await markdown
        .locator("h1")
        .first()
        .evaluate(el => parseFloat(getComputedStyle(el).fontSize)),
      20 * fontScale,
    );
    await page.locator("#custom-reader-options").click();
    await page.getByRole("button", { name: "重新生成", exact: true }).click();
    await page.getByRole("dialog", { name: "重新生成", exact: true }).waitFor();
    await audit("custom-dialog");

    for (const [surface, path, ready] of [
      ["library", "dev/library-preview.html", "#library-heading"],
      ["library-error", "dev/library-preview.html?error=auth", '[data-ui="library-error"]'],
      ["reader", "dev/reader-preview.html?multi&wide", '[data-ui="unifiedReader"]'],
      [
        "reader-japanese",
        "dev/reader-preview.html?long=ja&wide&locale=ja",
        '[data-ui="unifiedReader"]',
      ],
      ["reader-chinese", "dev/reader-preview.html?chinese=zh-TW&wide", '[data-ui="unifiedReader"]'],
      ["activity", "dev/activity-preview.html", '[data-ui="taskHistoryItem"]'],
      ["speech", "dev/speech-preview.html?mode=unsupported", '[data-ui="unifiedReader"]'],
      ["voice-resources", "dev/siri-download-task-preview.html", 'section[aria-label="Siri 聲音"]'],
    ]) {
      await open(path);
      await page.locator(ready).first().waitFor();
      if (surface.startsWith("reader")) {
        await page.screenshot({
          animations: "disabled",
          path: join(output, `reader-collapsed-${key}.png`),
        });
        await page.locator('[data-ui="analysis-toggle"]').first().click();
        await page.locator('[data-ui="analysis-content"]:visible').first().waitFor();
      }
      if (surface === "activity") {
        await page.locator('[data-ui="taskHistoryItem"] button').first().click();
      }
      if (surface === "speech")
        await page.getByRole("button", { name: "聲音設定", exact: true }).click();
      await audit(surface);
    }
    assert.deepEqual(errors, [], `${key}: browser errors`);
    await page.close();
  }
  await writeFile(join(output, "acceptance.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ output, surfaces: evidence.length, scenarios: cases.length }));
} finally {
  await browser?.close();
  await server.close();
}
