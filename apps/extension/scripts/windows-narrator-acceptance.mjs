import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-narrator-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5198, strictPort: true, watch: null },
});
let browser;
let readerBaseline;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  // The older speech-acceptance script assumes the previous collapsed-reader DOM.
  // Verify reading preserves the current DOM without restoring that retired layout.
  const baseline = await browser.newPage({ viewport: { width: 320, height: 850 } });
  await baseline.goto("http://127.0.0.1:5198/dev/speech-preview.html");
  const sourceSpeech = baseline
    .locator('[data-ui="analysis-source-header"]')
    .last()
    .getByRole("button", { name: "朗讀完整原句", exact: true });
  await sourceSpeech.waitFor();
  const before = await baseline.locator('[data-ui="inlineAnalysis"]').count();
  await sourceSpeech.click();
  await baseline.waitForFunction(() =>
    window.__speechPreview.requests.some(request => request.type === "speak"),
  );
  const after = await baseline.locator('[data-ui="inlineAnalysis"]').count();
  assert.equal(after, before, "speech preserves the current reader analysis state");
  readerBaseline = { before, after };
  await baseline.getByRole("button", { name: "聲音設定", exact: true }).click();
  await baseline.getByRole("heading", { name: "系統朗讀", exact: true }).waitFor();
  assert.equal(await baseline.locator('[data-ui="windows-narrator-experimental"]').count(), 0);
  await baseline.close();
  for (const width of [320, 480]) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const mode of ["narrator-empty", "narrator-ready"]) {
        await page.goto(`http://127.0.0.1:5198/dev/speech-preview.html?mode=${mode}`);
        await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
        await page.getByRole("button", { name: "聲音設定", exact: true }).click();
        const section = page.getByRole("region", { name: "系統朗讀", exact: true });
        await section.getByRole("heading", { name: "系統朗讀 實驗性" }).waitFor();
        assert.equal(
          await section.locator("h3 svg").count(),
          1,
          "experiment icon accompanies text",
        );
        assert.ok(
          await section.getByRole("link", { name: "設定與相容性說明" }).getAttribute("href"),
        );
        assert.equal(await page.getByRole("button", { name: /管理 Siri/ }).count(), 0);
        if (mode === "narrator-empty") {
          await section
            .getByText("尚未偵測到此語言相容的本機 Narrator 自然語音。", { exact: true })
            .waitFor();
          assert.equal(
            await section.getByRole("combobox", { name: "聲音", exact: true }).count(),
            0,
          );
          assert.equal(await section.getByRole("button", { name: "試聽", exact: true }).count(), 0);
        } else {
          await section.getByRole("combobox", { name: "聲音", exact: true }).click();
          await page.getByRole("option", { name: /Microsoft Aria.*實驗性/ }).click();
          await section.getByRole("button", { name: "試聽", exact: true }).click();
          await page.waitForFunction(() =>
            window.__speechPreview.requests.some(request => request.type === "speak"),
          );
          assert.equal(
            await page.evaluate(
              () =>
                window.__speechPreview.requests.find(request => request.type === "speak").input
                  .voiceId,
            ),
            "narrator:local-Aria",
          );
          await page.evaluate(() => window.__speechPreview.fail());
          await section
            .getByRole("alert")
            .filter({ hasText: "實驗性 Narrator 朗讀失敗" })
            .waitFor();
          await section.getByRole("button", { name: "試聽", exact: true }).click();
          await section.getByRole("button", { name: "停止朗讀", exact: true }).click();
        }
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "no horizontal overflow",
        );
        await page.screenshot({
          path: join(output, `${mode}-${width}-${dark ? "dark" : "light"}.png`),
          fullPage: true,
        });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  }
  console.log(
    JSON.stringify({
      output,
      readerBaseline,
      note: "Mock Host UI, 320/480px, light/dark; no actual Windows speech.",
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
