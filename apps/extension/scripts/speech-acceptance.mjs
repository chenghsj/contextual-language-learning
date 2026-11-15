import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("..", import.meta.url));
const resourceDirectory =
  "/System/Library/AssetsV2/com_apple_MobileAsset_UAF_Siri_TextToSpeech/purpose_auto/mock-aaron.asset";
const noraResourceDirectory = resourceDirectory.replace("mock-aaron.asset", "mock-nora.asset");
const output = await mkdtemp(join(tmpdir(), "cll-speech-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5197, strictPort: true, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 480]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:5197/dev/speech-preview.html");
    const groupSpeech = page
      .locator('[data-ui="analysis-source-header"]')
      .last()
      .getByRole("button", { name: "朗讀完整原句", exact: true });
    assert.equal(
      await page
        .locator('[data-ui="sourceSentence"]')
        .getByRole("button", { name: "朗讀完整原句", exact: true })
        .count(),
      0,
      "group speech is placed beside its source range, separate from single-cue play",
    );
    assert.equal(
      await groupSpeech.getAttribute("aria-describedby"),
      await page.locator('[data-ui="analysis-range"]').last().getAttribute("id"),
    );
    const alignment = await groupSpeech.evaluate(button => {
      const speech = button.getBoundingClientRect();
      const icon = button.querySelector("svg").getBoundingClientRect();
      return [
        ...button.closest('[data-ui="sourceUtterance"]').querySelectorAll('[data-ui="cue-play"]'),
      ].map(play => {
        const box = play.getBoundingClientRect();
        const playIcon = play.querySelector("svg").getBoundingClientRect();
        return {
          buttonCenter: Math.abs(speech.x + speech.width / 2 - box.x - box.width / 2),
          iconCenter: Math.abs(icon.x + icon.width / 2 - playIcon.x - playIcon.width / 2),
          size: [speech.width, speech.height, box.width, box.height],
        };
      });
    });
    for (const item of alignment) {
      assert.ok(
        item.buttonCenter <= 1 && item.iconCenter <= 1,
        "group speech and cue play share the same vertical line",
      );
      assert.deepEqual(item.size, [32, 32, 32, 32]);
    }
    await page.screenshot({ path: join(output, `aligned-controls-${width}.png`) });
    await groupSpeech.click();
    await page.waitForFunction(() =>
      window.__speechPreview.requests.some(request => request.type === "speak"),
    );
    const initial = await page.evaluate(() => ({
      speech: window.__speechPreview.requests.find(request => request.type === "speak"),
      playing: window.__speechPreview.playing(),
    }));
    assert.equal(initial.playing, false, "system speech pauses the playing video");
    assert.equal(
      initial.speech.input.voiceId,
      "mock-neural-en",
      "automatic selection prefers the neural voice",
    );
    assert.deepEqual(
      initial.speech.input.text.split("\u2029"),
      ["I was about to head out", "when you called."],
      "each original cue remains a distinct spoken segment",
    );
    assert.ok(
      initial.speech.input.text.includes("when"),
      "the complete cross-caption utterance is spoken",
    );
    assert.equal(
      await page.locator('[data-ui="inlineAnalysis"]').count(),
      0,
      "speech does not open a collapsed group",
    );
    await page.getByRole("button", { name: "停止朗讀", exact: true }).click();
    await page.locator('[data-ui="analysis-toggle"]').last().click();
    await page.getByRole("button", { name: "AI 延伸例句", exact: true }).click();
    await page.getByRole("button", { name: "朗讀整段對話", exact: true }).first().click();
    await page.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    assert.equal(
      await page.locator('[data-ui="inlineAnalysis"]').count(),
      1,
      "speech retains the open group",
    );
    const dialogue = await page.evaluate(
      () =>
        window.__speechPreview.requests.filter(request => request.type === "speak").at(-1).input
          .text,
    );
    assert.ok(dialogue.includes("\n"));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: join(output, `examples-${width}.png`), fullPage: true });
    await page.evaluate(() => window.__speechPreview.complete());
    await page.getByRole("button", { name: "朗讀整段對話", exact: true }).first().waitFor();
    await page.getByRole("button", { name: "朗讀 1", exact: true }).first().click();
    await page.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    await page.evaluate(() => window.__speechPreview.fail());
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "聲音設定", exact: true }).click();
    const speechLayout = await page
      .getByRole("region", { name: "系統朗讀", exact: true })
      .evaluate(section => {
        const bounds = selector => section.querySelector(selector).getBoundingClientRect();
        const language = bounds('[role="combobox"][aria-label="語言"]');
        const refresh = bounds('button[aria-label="重新整理聲音"]');
        const rate = bounds('[role="combobox"][aria-label="朗讀速度"]');
        const test = bounds('button[aria-label="試聽"]');
        return { language: language.y, refresh: refresh.y, rate: rate.y, test: test.y };
      });
    assert.ok(
      Math.abs(speechLayout.language - speechLayout.refresh) <= 1,
      "refresh stays beside language in every supported layout",
    );
    assert.ok(
      Math.abs(speechLayout.rate - speechLayout.test) <= 1,
      "speed and trial share a row at 320/480px",
    );
    await page.getByRole("combobox", { name: "聲音", exact: true }).click();
    await page.getByRole("option", { name: "Voice 2 · en-US · 神經語音", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("option", { name: /基本|Alex/ }).count(),
      0,
      "basic and unclassified voices are hidden",
    );
    await page.getByRole("option", { name: "Samantha · en-US · 增強", exact: true }).click();
    await page.getByRole("combobox", { name: "朗讀速度", exact: true }).click();
    await page.getByRole("option", { name: "0.75×", exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__speechPreview.settings()?.voices.en === "Samantha-enhanced" &&
        window.__speechPreview.settings().rate === 0.75,
    );
    await page.getByRole("button", { name: "試聽", exact: true }).click();
    await page.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    const trial = await page.evaluate(() =>
      window.__speechPreview.requests.filter(request => request.type === "speak").at(-1),
    );
    assert.equal(trial.input.voiceId, "Samantha-enhanced");
    assert.equal(trial.input.rate, 0.75);
    await page.screenshot({ path: join(output, `settings-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "停止朗讀", exact: true }).click();
    await page.getByRole("button", { name: "管理 Siri 聲音", exact: true }).click();
    await page.getByRole("tab", { name: "可下載", exact: true }).click();
    await page.getByRole("list", { name: "可下載的 Siri 聲音", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: join(output, `siri-download-${width}.png`), fullPage: true });
    assert.equal(await page.getByRole("combobox", { name: "聲音", exact: true }).count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "朗讀速度", exact: true }).count(), 0);
    await page.getByRole("button", { name: "返回一般設定", exact: true }).click();
    await page.getByRole("combobox", { name: "聲音", exact: true }).click();
    assert.equal(
      await page.getByRole("option", { name: /Aaron/ }).count(),
      0,
      "downloadable voices stay outside playback until installed",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "管理 Siri 聲音", exact: true }).click();
    await page.getByRole("tab", { name: "可下載", exact: true }).click();
    const downloadableRow = page
      .getByRole("list", { name: "可下載的 Siri 聲音", exact: true })
      .getByRole("listitem", { name: "Aaron", exact: true });
    await downloadableRow.getByRole("button", { name: "下載", exact: true }).waitFor();
    const resourceSpacing = await downloadableRow.evaluate(element => {
      const row = element.getBoundingClientRect();
      const heading = element.querySelector("[id]").getBoundingClientRect();
      const action = element.querySelector("button").getBoundingClientRect();
      return {
        left: heading.left - row.left,
        right: row.right - action.right,
        actionGap: action.left - heading.right,
        actionSize: [action.width, action.height],
        actionCenter: Math.abs(action.y + action.height / 2 - row.y - row.height / 2),
      };
    });
    await page.screenshot({
      path: join(output, `manager-download-inline-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    assert.ok(
      resourceSpacing.left >= 8 && resourceSpacing.right >= 8,
      "inline voice controls leave room for focus rings",
    );
    assert.ok(
      resourceSpacing.actionGap >= 12,
      "download action is separated from the voice text: " + JSON.stringify(resourceSpacing),
    );
    assert.deepEqual(resourceSpacing.actionSize, [36, 36]);
    assert.ok(resourceSpacing.actionCenter <= 1);
    assert.equal(await downloadableRow.locator("button[aria-expanded]").count(), 0);
    assert.equal(await downloadableRow.getByRole("button").textContent(), "");
    await downloadableRow.getByRole("button", { name: "下載", exact: true }).hover();
    await page.getByRole("tooltip", { name: "下載", exact: true }).waitFor();
    await downloadableRow.getByRole("button", { name: "下載", exact: true }).press("Escape");
    await page.getByRole("tooltip").waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("tooltip").count(), 0);
    for (const [error, expected] of [
      [
        "SIRI_DOWNLOAD_MISSING_CLIENT_IDENTITY",
        "Siri 下載元件缺少識別資訊，請更新本機服務後再試。",
      ],
      [
        "SIRI_DOWNLOAD_REJECTED (SiriTTSService.TTSError:1)",
        "macOS 拒絕下載聲音，請稍後重試，或到系統設定下載。",
      ],
      ["SIRI_DOWNLOAD_REQUEST_TIMED_OUT", "macOS 的語音下載服務沒有回應，請稍後重試。"],
    ]) {
      await page.evaluate(message => window.__speechPreview.rejectNextDownload(message), error);
      await page.getByRole("button", { name: "下載", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: expected }).waitFor();
      assert.equal(
        await downloadableRow.getByRole("alert").count(),
        1,
        "download errors stay with the affected voice",
      );
      assert.equal(
        await page
          .getByText("macOS 正在下載此聲音；離開此頁後仍會繼續下載。", { exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.__speechPreview.requests.filter(
              request => request.type === "getSpeechVoiceInstallation",
            ).length,
        ),
        0,
        "rejected requests never start installation polling",
      );
    }
    await page.getByRole("button", { name: "下載", exact: true }).click();
    await page
      .getByText("macOS 正在下載此聲音；離開此頁後仍會繼續下載。", { exact: true })
      .waitFor();
    await page.getByText("聲音已安裝，現在可以選擇朗讀。", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("tab", { name: "已下載", exact: true }).getAttribute("aria-selected"),
      "true",
    );
    await page.getByRole("button", { name: "返回一般設定", exact: true }).click();
    await page.getByRole("combobox", { name: "聲音", exact: true }).click();
    await page.getByRole("option", { name: "Aaron · en-US · 神經語音", exact: true }).click();
    await page.getByRole("button", { name: "試聽", exact: true }).click();
    await page.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__speechPreview.requests.filter(request => request.type === "speak").at(-1).input
            .voiceId,
      ),
      "siri:mock-Aaron",
    );
    await page.getByRole("button", { name: "停止朗讀", exact: true }).click();
    await page.screenshot({ path: join(output, `siri-installed-${width}.png`), fullPage: true });
    await page.getByRole("combobox", { name: "語言", exact: true }).click();
    await page.getByRole("option", { name: "繁體中文", exact: true }).click();
    await page.evaluate(() => window.__speechPreview.resourceOnly());
    await page.getByRole("button", { name: "管理 Siri 聲音", exact: true }).click();
    const managerLanguage = page.getByRole("combobox", { name: "聲音語言", exact: true });
    assert.match(await managerLanguage.textContent(), /繁體中文/);
    await page.getByText("此語言尚未下載 Siri 聲音。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("listitem", { name: "Aaron", exact: true }).count(), 0);
    await managerLanguage.click();
    await page.getByRole("option", { name: "所有語言", exact: true }).click();
    const resources = page.getByRole("list", {
      name: "已下載的 Siri 聲音",
      exact: true,
    });
    await resources.waitFor();
    assert.match(await resources.textContent(), /Aaron/);
    const resourceRow = resources.getByRole("listitem", { name: "Aaron", exact: true });
    await resourceRow.getByTitle(resourceDirectory, { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.__speechPreview.requests.some(request => request.type === "openSpeechVoiceFolder"),
      ),
      false,
      "the folder address is available before any Finder action",
    );
    await page.getByRole("button", { name: "開啟資源資料夾", exact: true }).click();
    await page.getByTitle(resourceDirectory, { exact: true }).waitFor();
    assert.equal(await page.getByText(resourceDirectory, { exact: true }).count(), 0);
    assert.equal(await page.getByText("已在 Finder 開啟資源資料夾。", { exact: true }).count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          window.__speechPreview.requests
            .filter(request => request.type === "openSpeechVoiceFolder")
            .at(-1).voiceId,
      ),
      "siri:mock-Aaron",
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.screenshot({ path: join(output, `siri-resources-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "刪除下載資源", exact: true }).click();
    await page.getByRole("alertdialog").waitFor();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          window.__speechPreview.requests.filter(request => request.type === "removeSpeechVoice")
            .length,
      ),
      0,
    );
    await page.evaluate(() => window.__speechPreview.rejectNextRemoval());
    await page.getByRole("button", { name: "刪除下載資源", exact: true }).click();
    await page.getByRole("button", { name: "刪除資源", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "macOS 未確認移除資源" }).waitFor();
    assert.equal(
      await resourceRow.getByRole("alert").count(),
      1,
      "removal errors stay with the affected voice",
    );
    assert.equal(
      await resources.count(),
      1,
      "unconfirmed removal keeps the voice available for management",
    );
    await page.getByRole("button", { name: "刪除下載資源", exact: true }).click();
    await page.getByRole("button", { name: "刪除資源", exact: true }).click();
    await page
      .getByText("下載資源已移除；若仍有程式使用此聲音，macOS 可能再次下載。", { exact: true })
      .waitFor();
    await page.getByText("沒有查到已下載的 Siri 語音資源。", { exact: true }).waitFor();
    assert.equal(
      await page.locator('[data-ui="voice-operation-status"]').count(),
      0,
      "successful removal does not occupy persistent list space",
    );
    const removalToast = page.locator("[data-sonner-toast]").filter({ hasText: "下載資源已移除" });
    assert.equal(await removalToast.count(), 1, "resource removal uses the shared Sonner viewport");
    await removalToast.getByRole("button", { name: "關閉通知", exact: true }).click();
    await removalToast.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "返回一般設定", exact: true }).click();
    await page.getByRole("combobox", { name: "聲音", exact: true }).click();
    assert.equal(await page.getByRole("option", { name: /Aaron/ }).count(), 0);
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "聲音", exact: true }).click();
    await page.getByRole("option", { name: "聲音2 · zh-TW · 神經語音", exact: true }).click();
    await page.waitForFunction(
      () => window.__speechPreview.settings()?.voices["zh-TW"] === "mock-neural-tw",
    );
    await page.getByRole("button", { name: "試聽", exact: true }).click();
    await page.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    const chineseTrial = await page.evaluate(() =>
      window.__speechPreview.requests.filter(request => request.type === "speak").at(-1),
    );
    assert.equal(chineseTrial.input.language, "zh-TW");
    assert.equal(chineseTrial.input.voiceId, "mock-neural-tw");
    assert.equal(chineseTrial.input.text, "我們一起學習新的事物吧。");
    await page.screenshot({ path: join(output, `chinese-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "停止朗讀", exact: true }).click();
    await page.getByRole("combobox", { name: "語言", exact: true }).click();
    await page.getByRole("option", { name: "簡體中文", exact: true }).click();
    await page.getByText("此語言目前沒有可用的高品質系統語音。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "試聽", exact: true }).count(), 0);
    await page.getByRole("combobox", { name: "語言", exact: true }).click();
    await page.getByRole("option", { name: "日語", exact: true }).click();
    await page.getByText("此語言目前沒有可用的高品質系統語音。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "試聽", exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    const aliasesPage = await browser.newPage({ viewport: { width, height: 850 } });
    await aliasesPage.goto("http://127.0.0.1:5197/dev/speech-preview.html?mode=aliases");
    await aliasesPage.evaluate(() => window.__speechPreview.saveLegacyAlias());
    await aliasesPage.getByRole("button", { name: "聲音設定", exact: true }).click();
    const aliasChoice = aliasesPage.getByRole("combobox", { name: "聲音", exact: true });
    await aliasChoice.waitFor();
    assert.match(await aliasChoice.textContent(), /^Aaron/);
    await aliasChoice.click();
    assert.equal(
      await aliasesPage
        .getByRole("option", { name: "Aaron · en-US · 神經語音", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await aliasesPage
        .getByRole("option", { name: "aaron · en-US · 神經語音", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await aliasesPage
        .getByRole("option", { name: "Nora · en-US · 神經語音", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await aliasesPage
        .getByRole("option", { name: "nora · en-US · 神經語音", exact: true })
        .count(),
      0,
    );
    await aliasesPage.screenshot({ path: join(output, `aliases-${width}.png`), fullPage: true });
    await aliasesPage.keyboard.press("Escape");
    await aliasesPage.getByRole("button", { name: "試聽", exact: true }).click();
    await aliasesPage.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    const aliasState = await aliasesPage.evaluate(() => ({
      speech: window.__speechPreview.requests.filter(request => request.type === "speak").at(-1),
      saved: window.__speechPreview.settings(),
    }));
    assert.equal(aliasState.speech.input.voiceId, "siri:aaron");
    assert.equal(aliasState.saved.voices.en, "siri:aaron-old");
    assert.equal(aliasState.speech.input.rate, 0.75);
    await aliasesPage.getByRole("button", { name: "停止朗讀", exact: true }).click();
    await aliasesPage.getByRole("button", { name: "管理 Siri 聲音", exact: true }).click();
    const aliasResources = aliasesPage.getByRole("list", {
      name: "已下載的 Siri 聲音",
      exact: true,
    });
    await aliasResources.waitFor();
    assert.equal(
      await aliasResources.getByRole("listitem", { name: "Aaron", exact: true }).count(),
      1,
    );
    assert.equal(
      await aliasResources.getByRole("listitem", { name: "Nora", exact: true }).count(),
      1,
    );
    assert.equal(await aliasResources.getByRole("listitem", { name: /^aaron|^nora/ }).count(), 0);
    assert.equal(await aliasesPage.getByText(/fmvoice|natural/).count(), 0);
    assert.equal(
      await aliasesPage.getByText("此語言沒有其他可下載的 Siri 聲音。", { exact: true }).count(),
      0,
    );
    const aliasResourceRow = aliasResources.getByRole("listitem", { name: "Aaron", exact: true });
    await aliasResourceRow.getByTitle(resourceDirectory, { exact: true }).waitFor();
    const savedBeforePreview = await aliasesPage.evaluate(() => window.__speechPreview.settings());
    await aliasResources
      .getByRole("listitem", { name: "Nora", exact: true })
      .getByRole("button", { name: "試聽", exact: true })
      .click();
    await aliasResources
      .getByRole("listitem", { name: "Nora", exact: true })
      .getByRole("button", { name: "停止朗讀", exact: true })
      .waitFor();
    const previewRequest = await aliasesPage.evaluate(
      () =>
        window.__speechPreview.requests.filter(request => request.type === "speak").at(-1).input,
    );
    assert.equal(
      previewRequest.voiceId,
      "siri:nora",
      "the row preview overrides the saved Aaron preference",
    );
    assert.equal(previewRequest.language, "en-US");
    assert.equal(previewRequest.text, "Let's learn something new together.");
    assert.equal(previewRequest.rate, 0.75);
    assert.deepEqual(
      await aliasesPage.evaluate(() => window.__speechPreview.settings()),
      savedBeforePreview,
    );
    const noraRow = aliasResources.getByRole("listitem", { name: "Nora", exact: true });
    await aliasesPage.evaluate(() => window.__speechPreview.fail());
    await noraRow.getByRole("alert").waitFor();
    await noraRow.getByRole("button", { name: "試聽", exact: true }).click();
    await noraRow.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    assert.equal(
      await noraRow.getByRole("alert").count(),
      0,
      "retry clears the row's playback error",
    );
    await aliasesPage.evaluate(() => window.__speechPreview.complete());
    await noraRow.getByRole("button", { name: "試聽", exact: true }).waitFor();
    await aliasResources
      .getByRole("listitem", { name: "Aaron", exact: true })
      .getByRole("button", { name: "試聽", exact: true })
      .click();
    await aliasResourceRow.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    assert.equal(
      await aliasResources.getByRole("button", { name: "停止朗讀", exact: true }).count(),
      1,
    );
    const activePreview = await aliasesPage.evaluate(
      () => window.__speechPreview.requests.filter(request => request.type === "speak").at(-1).id,
    );
    await aliasesPage.getByRole("tab", { name: "可下載", exact: true }).click();
    await aliasesPage.waitForFunction(
      speechId =>
        window.__speechPreview.requests.some(
          request => request.type === "stopSpeech" && request.speechId === speechId,
        ),
      activePreview,
    );
    await aliasesPage.getByRole("tab", { name: "已下載", exact: true }).click();
    await aliasResources
      .getByRole("listitem", { name: "Nora", exact: true })
      .getByTitle(noraResourceDirectory, { exact: true })
      .waitFor();
    assert.equal(await aliasResources.locator("button[aria-expanded]").count(), 0);
    await aliasResourceRow.getByRole("button", { name: "開啟資源資料夾", exact: true }).click();
    await aliasResourceRow.getByTitle(resourceDirectory, { exact: true }).waitFor();
    assert.equal(await aliasesPage.getByRole("button", { name: "下載", exact: true }).count(), 0);
    assert.equal(
      await aliasesPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await aliasesPage.close();
    const priorityPage = await browser.newPage({ viewport: { width, height: 850 } });
    await priorityPage.goto("http://127.0.0.1:5197/dev/speech-preview.html?mode=siri-priority");
    await priorityPage.evaluate(() => window.__speechPreview.savePublicPreference());
    await priorityPage.getByRole("button", { name: "聲音設定", exact: true }).click();
    const priorityVoice = priorityPage.getByRole("combobox", { name: "聲音", exact: true });
    await priorityVoice.waitFor();
    assert.match(await priorityVoice.textContent(), /^Shufen/);
    await priorityVoice.click();
    assert.equal(await priorityPage.getByRole("option", { name: /Chenghan/ }).count(), 1);
    assert.equal(await priorityPage.getByRole("option", { name: /Shufen/ }).count(), 1);
    assert.equal(await priorityPage.getByRole("option", { name: /^聲音[12] ·/ }).count(), 0);
    await priorityPage.screenshot({
      path: join(output, `siri-priority-${width}.png`),
      fullPage: true,
    });
    await priorityPage.keyboard.press("Escape");
    await priorityPage.getByRole("button", { name: "試聽", exact: true }).click();
    await priorityPage.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    const priorityState = await priorityPage.evaluate(() => ({
      request: window.__speechPreview.requests.filter(request => request.type === "speak").at(-1),
      saved: window.__speechPreview.settings(),
    }));
    const oldShufenId = "com.apple.ttsbundle.gryphon-neural_Shufen_zh-TW_premium";
    assert.equal(priorityState.request.input.voiceId, "siri:shufen");
    assert.equal(priorityState.request.input.rate, 0.75);
    assert.equal(priorityState.saved.voices["zh-TW"], oldShufenId);
    await priorityPage.getByRole("button", { name: "停止朗讀", exact: true }).click();
    const manageInset = await priorityPage
      .getByRole("button", { name: "管理 Siri 聲音", exact: true })
      .evaluate(button => {
        const style = getComputedStyle(button);
        const bounds = button.getBoundingClientRect();
        const parent = button.parentElement.getBoundingClientRect();
        const voice = button
          .closest("section")
          .querySelector('[role="combobox"][aria-label="聲音"]')
          .getBoundingClientRect();
        return {
          padding: [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)],
          left: bounds.left - parent.left,
          right: parent.right - bounds.right,
          voiceLeft: Math.abs(bounds.left - voice.left),
          voiceRight: Math.abs(bounds.right - voice.right),
        };
      });
    assert.ok(
      manageInset.padding.every(inset => inset >= 12),
      "management text and arrow have horizontal breathing room",
    );
    assert.ok(
      Math.abs(manageInset.left) <= 1 &&
        Math.abs(manageInset.right) <= 1 &&
        manageInset.voiceLeft <= 1 &&
        manageInset.voiceRight <= 1,
      "management button aligns with the full-width voice field",
    );
    await priorityPage.getByRole("button", { name: "管理 Siri 聲音", exact: true }).click();
    assert.match(
      await priorityPage.getByRole("combobox", { name: "聲音語言", exact: true }).textContent(),
      /繁體中文/,
    );
    const chineseResources = priorityPage.getByRole("list", {
      name: "已下載的 Siri 聲音",
      exact: true,
    });
    await chineseResources.waitFor();
    assert.equal(await chineseResources.getByRole("listitem").count(), 2);
    assert.equal(await chineseResources.getByRole("button").count(), 6);
    assert.equal(
      await priorityPage.getByRole("listitem", { name: "Nora", exact: true }).count(),
      0,
    );
    assert.equal(
      await priorityPage.getByRole("combobox", { name: "朗讀速度", exact: true }).count(),
      0,
    );
    await priorityPage.screenshot({
      path: join(output, `manager-chinese-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await priorityPage.getByRole("tab", { name: "可下載", exact: true }).click();
    await priorityPage.getByText("此語言沒有其他可下載的 Siri 聲音。", { exact: true }).waitFor();
    assert.equal(await chineseResources.count(), 0);
    await priorityPage.getByRole("combobox", { name: "聲音語言", exact: true }).click();
    await priorityPage.getByRole("option", { name: "所有語言", exact: true }).click();
    await priorityPage.getByRole("tab", { name: "已下載", exact: true }).click();
    assert.equal(
      await priorityPage
        .getByRole("listitem", { name: "Nora", exact: true })
        .getByRole("button", { name: "刪除下載資源", exact: true })
        .count(),
      1,
    );
    assert.equal(await priorityPage.getByText(/共用的系統資源/).count(), 0);
    await priorityPage
      .getByRole("listitem", { name: "Nora", exact: true })
      .getByTitle(noraResourceDirectory, { exact: true })
      .waitFor();
    await priorityPage.screenshot({
      path: join(output, `manager-all-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await priorityPage.getByRole("button", { name: "返回一般設定", exact: true }).click();
    await priorityPage.waitForFunction(() => document.activeElement?.id === "system-speech-manage");
    await priorityPage.screenshot({
      path: join(output, `speech-main-${width}.png`),
      fullPage: true,
    });
    assert.match(
      await priorityPage.getByRole("combobox", { name: "語言", exact: true }).textContent(),
      /繁體中文/,
    );
    await priorityPage.getByRole("combobox", { name: "語言", exact: true }).click();
    await priorityPage.getByRole("option", { name: "日語", exact: true }).click();
    await priorityVoice.click();
    assert.equal(await priorityPage.getByRole("option", { name: /Sakura/ }).count(), 1);
    assert.equal(await priorityPage.getByRole("option", { name: /Shufen|Chenghan/ }).count(), 0);
    await priorityPage.getByRole("option", { name: /Sakura/ }).click();
    await priorityPage.getByRole("button", { name: "試聽", exact: true }).click();
    await priorityPage.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    const fallbackTrial = await priorityPage.evaluate(() =>
      window.__speechPreview.requests.filter(request => request.type === "speak").at(-1),
    );
    assert.equal(fallbackTrial.input.voiceId, "mock-public-ja");
    await priorityPage.getByRole("button", { name: "停止朗讀", exact: true }).click();
    await priorityPage.getByRole("combobox", { name: "語言", exact: true }).click();
    await priorityPage.getByRole("option", { name: "簡體中文", exact: true }).click();
    await priorityPage.getByText("此語言目前沒有可用的高品質系統語音。", { exact: true }).waitFor();
    assert.equal(await priorityVoice.count(), 0);
    assert.equal(await priorityPage.getByRole("button", { name: "試聽", exact: true }).count(), 0);
    await priorityPage.getByRole("combobox", { name: "語言", exact: true }).click();
    await priorityPage.getByRole("option", { name: "繁體中文", exact: true }).click();
    await priorityPage.evaluate(() => window.__speechPreview.usePublicFallback());
    await priorityPage.getByRole("button", { name: "重新整理聲音", exact: true }).click();
    await priorityPage.getByText("聲音2 · zh-TW · 神經語音", { exact: true }).waitFor();
    await priorityVoice.click();
    assert.equal(await priorityPage.getByRole("option", { name: /^聲音[12] ·/ }).count(), 2);
    assert.equal(await priorityPage.getByRole("option", { name: /Shufen|Chenghan/ }).count(), 0);
    await priorityPage.keyboard.press("Escape");
    await priorityPage.getByRole("button", { name: "試聽", exact: true }).click();
    await priorityPage.getByRole("button", { name: "停止朗讀", exact: true }).waitFor();
    const refreshedTrial = await priorityPage.evaluate(() =>
      window.__speechPreview.requests.filter(request => request.type === "speak").at(-1),
    );
    assert.equal(refreshedTrial.input.voiceId, oldShufenId);
    await priorityPage.getByRole("button", { name: "停止朗讀", exact: true }).click();
    assert.equal(
      await priorityPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await priorityPage.close();
    const downloadedPage = await browser.newPage({ viewport: { width, height: 850 } });
    await downloadedPage.goto("http://127.0.0.1:5197/dev/speech-preview.html?mode=downloaded");
    await downloadedPage.getByRole("button", { name: "聲音設定", exact: true }).click();
    await downloadedPage.getByRole("button", { name: "管理 Siri 聲音", exact: true }).click();
    await downloadedPage
      .getByText(
        "資源已下載，但本機服務尚無法辨識此聲音。請更新本機服務後重新整理聲音，不需再次下載。",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await downloadedPage.getByRole("button", { name: "試聽", exact: true }).isDisabled(),
      true,
      "downloaded but unplayable resources cannot be previewed",
    );
    await downloadedPage.getByRole("tab", { name: "可下載", exact: true }).click();
    await downloadedPage.getByText("此語言沒有其他可下載的 Siri 聲音。", { exact: true }).waitFor();
    assert.equal(
      await downloadedPage.getByRole("list", { name: "可下載的 Siri 聲音", exact: true }).count(),
      0,
    );
    assert.equal(
      await downloadedPage.getByRole("button", { name: "下載", exact: true }).count(),
      0,
    );
    assert.equal(
      await downloadedPage.evaluate(
        () =>
          window.__speechPreview.requests.filter(request => request.type === "installSpeechVoice")
            .length,
      ),
      0,
    );
    await downloadedPage.screenshot({
      path: join(output, `downloaded-unreported-${width}.png`),
      fullPage: true,
    });
    await downloadedPage.close();
    for (const mode of ["unsupported", "disconnected", "missing-language", "no-siri"]) {
      const statePage = await browser.newPage({ viewport: { width, height: 850 } });
      const stateErrors = [];
      statePage.on("pageerror", error => stateErrors.push(error.message));
      await statePage.goto(`http://127.0.0.1:5197/dev/speech-preview.html?mode=${mode}`);
      const absent =
        mode === "unsupported" || mode === "disconnected" || mode === "missing-language";
      if (mode === "unsupported")
        await statePage
          .getByText("此電腦的系統版本或平台不支援系統朗讀。", { exact: true })
          .waitFor();
      if (mode === "disconnected")
        await statePage.getByRole("button", { name: "重新連線", exact: true }).waitFor();
      if (mode === "missing-language")
        await statePage
          .getByText("此語言目前沒有可用的高品質系統語音。", { exact: true })
          .waitFor();
      if (mode === "no-siri")
        await statePage.getByRole("button", { name: "朗讀完整原句", exact: true }).last().waitFor();
      assert.equal(
        (await statePage.getByRole("button", { name: "朗讀完整原句", exact: true }).count()) > 0,
        !absent,
      );
      assert.ok(
        (await statePage.getByRole("button", { name: /^播放這句/ }).count()) > 0,
        "source audio controls stay present",
      );
      await statePage.locator('[data-ui="analysis-toggle"]').last().click();
      await statePage.getByRole("button", { name: "AI 延伸例句", exact: true }).click();
      assert.equal(
        (await statePage.getByRole("button", { name: "朗讀整段對話", exact: true }).count()) > 0,
        !absent,
      );
      assert.equal(
        (await statePage.getByRole("button", { name: "朗讀 1", exact: true }).count()) > 0,
        !absent,
      );
      assert.equal(
        await statePage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await statePage.screenshot({
        path: join(output, `reader-${mode}-${width}.png`),
        fullPage: true,
      });
      await statePage.getByRole("button", { name: "聲音設定", exact: true }).click();
      if (mode === "no-siri") {
        await statePage.getByRole("button", { name: "試聽", exact: true }).waitFor();
        await statePage.waitForFunction(() =>
          window.__speechPreview.requests.some(
            request => request.type === "listSpeechVoiceCatalog",
          ),
        );
      } else {
        await statePage.getByRole("region", { name: "系統朗讀", exact: true }).waitFor();
      }
      assert.equal(
        (await statePage.getByRole("combobox", { name: "聲音", exact: true }).count()) > 0,
        !absent,
      );
      assert.equal(
        (await statePage.getByRole("combobox", { name: "朗讀速度", exact: true }).count()) > 0,
        !absent,
      );
      assert.equal(
        (await statePage.getByRole("button", { name: "試聽", exact: true }).count()) > 0,
        !absent,
      );
      assert.equal(
        await statePage.locator('[data-ui="speech-trial"]').count(),
        absent ? 0 : 1,
        "unavailable speech removes the entire trial row",
      );
      if (mode === "unsupported" || mode === "disconnected") {
        assert.equal(
          await statePage.getByRole("combobox", { name: "語言", exact: true }).count(),
          0,
        );
      }
      if (mode !== "missing-language") {
        assert.equal(
          await statePage.getByRole("button", { name: "取得更多 Siri 聲音", exact: true }).count(),
          0,
        );
        assert.equal(
          await statePage.getByRole("button", { name: "管理 Siri 聲音", exact: true }).count(),
          0,
        );
      } else await statePage.getByRole("button", { name: "管理 Siri 聲音", exact: true }).waitFor();
      assert.equal(
        await statePage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await statePage.screenshot({
        path: join(output, `settings-${mode}-${width}.png`),
        fullPage: true,
      });
      if (mode === "disconnected") {
        await statePage.evaluate(() => window.__speechPreview.recover());
        await statePage.getByRole("button", { name: "重新連線", exact: true }).click();
        await statePage.getByRole("button", { name: "試聽", exact: true }).waitFor();
        await statePage.getByRole("button", { name: "聲音設定", exact: true }).click();
        await statePage.getByRole("button", { name: "朗讀完整原句", exact: true }).last().waitFor();
      }
      assert.deepEqual(stateErrors, []);
      await statePage.close();
    }
  }
  process.stdout.write(
    JSON.stringify({
      output,
      checks:
        "320/480px, complete utterance, video pause, dialogue/line, completion/failure, voice/rate persistence, missing-language voice, Siri catalog/download/installation/playable selection, cross-language resource folder, removal confirmation/cancel/failure/success, unsupported/disconnected/missing-language/no-Siri layouts, reconnection restores reader controls",
    }) + "\n",
  );
} finally {
  await browser?.close();
  await server.close();
}
