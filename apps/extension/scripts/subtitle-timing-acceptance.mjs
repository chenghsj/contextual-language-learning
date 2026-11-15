// Manual timing correction and playback integration against isolated service fixtures.
import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-subtitle-timing-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5187, strictPort: true, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const [width, height, theme] of [
    [320, 800, "light"],
    [900, 800, "dark"],
    [390, 320, "light"],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:5187/dev/redesign-preview.html?theme=${theme}&captions=early-ending`,
    );
    await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    // Allow the drift test to extend beyond the fixture's original 30-second duration.
    const mockPlayer = () => {
      const original = chrome.tabs.sendMessage;
      window.previewCalls = [];
      window.previewPlaying = false;
      chrome.tabs.sendMessage = async (id, message) => {
        if (message.type.includes("AUDIO")) throw new Error("Audio analysis was removed");
        if (message.type === "LOOP_SET") {
          window.previewCalls.push(message);
          window.previewPlaying = true;
          return { ok: true };
        }
        if (message.type === "LOOP_CLEAR" || message.type === "PLAYBACK_PAUSE") {
          window.previewCalls.push(message);
          window.previewPlaying = false;
          return { ok: true };
        }
        return message.type === "PLAYBACK_STATUS_GET"
          ? { ok: true, currentMs: 5000, durationMs: 60000, playing: window.previewPlaying }
          : original(id, message);
      };
    };
    await page.evaluate(mockPlayer);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
    const editor = page.locator('[data-ui="subtitle-editor"]');
    const actions = editor.getByRole("button", { name: "字幕操作", exact: true });
    const dialog = page.getByRole("dialog", { name: "校正字幕時間", exact: true });
    const open = async () => {
      await actions.click();
      await page.getByRole("button", { name: "校正字幕時間", exact: true }).click();
      await dialog.waitFor();
    };
    const mode = async name => {
      await dialog.getByRole("combobox", { name: "校正方式" }).click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    const preview = dialog.getByRole("button", { name: "預覽變更", exact: true });
    const apply = dialog.getByRole("button", { name: "套用時間校正", exact: true });
    const offset = dialog.getByRole("textbox", { name: "位移秒數", exact: true });
    await open();
    assert.equal(await apply.isDisabled(), true);
    assert.equal(await dialog.locator('input[type="file"]').count(), 0);
    assert.equal(await dialog.getByRole("button", { name: "分析 YouTube 音訊" }).count(), 0);
    await dialog.getByRole("combobox", { name: "校正方式" }).click();
    assert.deepEqual(await page.getByRole("option").allTextContents(), [
      "整體位移",
      "校正逐漸偏移",
    ]);
    await page.getByRole("option", { name: "整體位移", exact: true }).click();
    await preview.click();
    await dialog.getByRole("status").filter({ hasText: "沒有可套用的變更" }).waitFor();
    assert.equal(await apply.isDisabled(), true);
    await offset.fill("-0.200");
    await preview.click();
    await dialog.getByRole("status").filter({ hasText: "將更新的字幕數: 3" }).waitFor();
    assert.match(await dialog.innerText(), /校正後: 00:07\.8 → 00:11\.2/);
    assert.doesNotMatch(await dialog.locator("ol").innerText(), /\d{2}:\d{2}:\d{2}\.\d{3}/);
    // Losing window focus or remounting the modal must not erase unapplied results.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await open();
    await dialog.getByRole("status").filter({ hasText: "將更新的字幕數: 3" }).waitFor();
    assert.equal(await apply.isEnabled(), true);
    assert.equal(await offset.getAttribute("value"), "-0.200");
    if (width === 900) {
      await page.waitForFunction(async () => {
        const { readDraft } = await import("/src/lib/draft-db.ts");
        const saved = await readDraft("subtitles-v1");
        return saved?.timingPreviews?.some(([, entry]) => entry.inputs?.offset === "-0.200");
      });
      await page.reload();
      await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
      await page.evaluate(mockPlayer);
      await page.getByRole("button", { name: "預覽字幕", exact: true }).click();
      await open();
      await dialog.getByRole("status").filter({ hasText: "將更新的字幕數: 3" }).waitFor();
      assert.equal(await apply.isEnabled(), true);
    }
    await dialog.getByRole("button", { name: "試聽這段 · 校正前", exact: true }).first().click();
    await page.waitForFunction(() =>
      window.previewCalls.some(
        x => x.type === "LOOP_SET" && x.startMs === 8040 && x.endMs === 11440,
      ),
    );
    await dialog.getByRole("button", { name: "試聽這段 · 校正後", exact: true }).first().click();
    await page.waitForFunction(() =>
      window.previewCalls.some(
        x => x.type === "LOOP_SET" && x.startMs === 7840 && x.endMs === 11240,
      ),
    );
    await dialog.getByRole("button", { name: "停止試聽 · 校正後", exact: true }).first().click();
    await page.waitForFunction(() => !window.previewPlaying);
    assert.equal(await apply.isEnabled(), true);
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    const box = await apply.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= height, "apply stays reachable in short windows");
    await dialog.screenshot({ path: join(output, `offset-${width}-${height}-${theme}.png`) });
    await dialog.getByRole("button", { name: "試聽這段 · 校正後", exact: true }).first().click();
    await apply.click();
    await dialog.waitFor({ state: "detached" });
    await page.waitForFunction(() => !window.previewPlaying);
    assert.equal(
      await editor.getByRole("button", { name: "00:07.8 → 00:11.2", exact: true }).count(),
      1,
    );
    // Cancel and invalid input do not modify the draft; settings invalidate the preview.
    await open();
    await mode("整體位移");
    await offset.fill("-100");
    await preview.click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await apply.isDisabled(), true);
    await offset.fill("0.5");
    await preview.click();
    await dialog.getByRole("status").filter({ hasText: "將更新的字幕數: 3" }).waitFor();
    await offset.fill("0.6");
    assert.equal(await apply.isDisabled(), true);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await editor.getByRole("button", { name: "00:07.8 → 00:11.2", exact: true }).count(),
      1,
    );
    await open();
    await mode("整體位移");
    await offset.fill("0.5");
    await preview.click();
    await apply.click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(
      await editor.getByRole("button", { name: "00:08.3 → 00:11.7", exact: true }).count(),
      1,
    );
    await open();
    await mode("校正逐漸偏移");
    for (const [name, value] of [
      ["第一個字幕位置", "00:01"],
      ["第一個實際位置", "00:02"],
      ["第二個字幕位置", "00:11"],
      ["第二個實際位置", "00:13"],
    ])
      await dialog.getByRole("textbox", { name, exact: true }).fill(value);
    await preview.click();
    await dialog.getByRole("status").filter({ hasText: "將更新的字幕數: 3" }).waitFor();
    await dialog.screenshot({ path: join(output, `anchors-${width}-${height}-${theme}.png`) });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await open();
    await dialog.getByRole("status").filter({ hasText: "將更新的字幕數: 3" }).waitFor();
    assert.equal(
      await dialog
        .getByRole("textbox", { name: "第二個實際位置", exact: true })
        .getAttribute("value"),
      "00:13",
    );
    await apply.click();
    await dialog.waitFor({ state: "detached" });
    await open();
    assert.equal(await apply.isDisabled(), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.waitForTimeout(100);
    assert.equal(await actions.evaluate(el => el === document.activeElement), true);
    await actions.click();
    await page.getByRole("button", { name: "還原原始字幕", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "還原原始字幕", exact: true })
      .click();
    await page.getByRole("alertdialog").waitFor({ state: "detached" });
    assert.equal(
      await editor.getByRole("button", { name: "00:08.0 → 00:19.0", exact: true }).count(),
      1,
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Manual subtitle timing acceptance passed; screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
