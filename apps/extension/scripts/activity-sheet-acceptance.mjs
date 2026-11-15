import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "cll-activity-sheet-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 417, height: 720 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Observe fixture Native ports so the real controller can be forced to reconnect.
  // This uses the actual App and controller with a simulated Host, never an installed Host.
  await page.addInitScript(() => {
    window.testNativePorts = [];
    window.testHistoryRequests = 0;
    Object.defineProperty(window, "chrome", {
      configurable: true,
      set(value) {
        const connect = value.runtime.connect;
        value.runtime.connect = (...args) => {
          const port = connect(...args);
          const send = port.postMessage;
          port.postMessage = request => {
            if (request.type === "listJobs") window.testHistoryRequests++;
            send(request);
          };
          return port;
        };
        const connectNative = value.runtime.connectNative;
        value.runtime.connectNative = (...args) => {
          const port = connectNative(...args);
          const entry = { port, live: true };
          window.testNativePorts.push(entry);
          port.onDisconnect.addListener(() => {
            entry.live = false;
          });
          return port;
        };
        Object.defineProperty(window, "chrome", { configurable: true, writable: true, value });
      },
    });
  });
  await page.goto(server.resolvedUrls.local[0] + "dev/redesign-preview.html");
  await page.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
  const sheet = page.getByRole("dialog");
  const tooltip = page.getByRole("tooltip");
  const countRequests = () => page.evaluate(() => window.testHistoryRequests);

  await page.locator("#header-activity").click();
  await sheet.waitFor();
  const refresh = sheet.getByRole("button", { name: "重新整理任務", exact: true });
  await refresh.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      button => button.textContent.includes("重新整理任務") && !button.disabled,
    ),
  );
  const beforeRecovery = await countRequests();
  await page.evaluate(() => {
    const live = window.testNativePorts.find(entry => entry.live);
    if (!live) throw new Error("No live fixture Native port");
    live.port.disconnect();
  });
  await page.waitForFunction(before => window.testHistoryRequests > before, beforeRecovery);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      button => button.textContent.includes("重新整理任務") && !button.disabled,
    ),
  );
  assert.equal(await countRequests(), beforeRecovery + 1, "reconnect refreshes exactly once");
  await page.waitForTimeout(400);
  assert.equal(await countRequests(), beforeRecovery + 1, "history reply must not loop");
  await refresh.click();
  await page.waitForTimeout(200);
  assert.equal(await countRequests(), beforeRecovery + 2, "manual refresh remains available");
  console.log("PASS actual App/controller recovery and manual activity refresh");

  for (const id of ["header-activity", "header-settings"]) {
    if (id === "header-settings") {
      await sheet.getByRole("button", { name: "關閉", exact: true }).click();
      await sheet.waitFor({ state: "detached" });
      await page.locator("#header-settings").click();
      await sheet.waitFor();
    }
    await sheet.getByRole("button", { name: "關閉", exact: true }).click();
    // The Sheet close button overlaps the Settings icon; move away during exit.
    await page.mouse.move(10, 400);
    await sheet.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement.id), id);
    assert.equal(await tooltip.count(), 0, "restored focus must not open a tooltip");
    await page.locator("#" + id).hover();
    await tooltip.waitFor();
    await page.mouse.move(10, 400);
    assert.equal(await tooltip.count(), 0, "pointer leave dismisses the tooltip after Sheet close");
    // Focus should still be accessible with the keyboard after restoration.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await tooltip.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), id);
    await page.keyboard.press("Escape");
    assert.equal(await tooltip.count(), 0);
    // Keyboard-opened Sheets must also restore focus without reopening the tooltip.
    await page.keyboard.press("Enter");
    await sheet.waitFor();
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement.id), id);
    assert.equal(await tooltip.count(), 0);
    console.log("PASS Sheet focus restoration, hover leave, Tab and Escape:", id);
    if (id === "header-activity") {
      await page.locator("#header-activity").click();
      await sheet.waitFor();
    }
  }
  assert.deepEqual(errors, []);

  // Real App/controller, controlled simulated Host; no provider calls or user data.
  for (const width of [320, 417]) {
    const queuePage = await browser.newPage({ viewport: { width, height: 720 } });
    queuePage.setDefaultTimeout(10000);
    const queueErrors = [];
    queuePage.on("pageerror", error => queueErrors.push(error.message));
    await queuePage.goto(
      server.resolvedUrls.local[0] + "dev/redesign-preview.html?activityQueue=1",
    );
    await queuePage.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    const wizard = queuePage.locator("#page-panel-create");
    const titleInput = queuePage.getByRole("textbox", { name: "影片／內容標題", exact: true });
    const firstTitle = "First video — " + "很長的影片名稱與內容說明".repeat(8);
    const secondTitle = "Second video — keep my draft";
    await queuePage.getByRole("button", { name: "修改標題與網址", exact: true }).click();
    await titleInput.fill(firstTitle);
    await queuePage.getByRole("button", { name: "下一步", exact: true }).click();
    await queuePage.getByRole("button", { name: "下一步", exact: true }).click();
    await queuePage.evaluate(() => {
      window.acceptance.holdAdmission = true;
    });
    await wizard.locator("footer").getByRole("button", { name: "建立內容", exact: true }).click();
    await queuePage.waitForFunction(() =>
      window.acceptance.commands.some(request => request.type === "generate"),
    );
    assert.equal(await wizard.locator("footer button").last().isDisabled(), true);
    assert.equal(
      await queuePage.getByText("已加入佇列", { exact: true }).count(),
      0,
      "no success before persistence",
    );
    const firstId = await queuePage.evaluate(
      () => window.acceptance.commands.find(request => request.type === "generate").id,
    );
    await wizard.locator("nav").getByRole("button", { name: "影片", exact: true }).click();
    await titleInput.fill(secondTitle);
    await queuePage
      .getByRole("textbox", { name: "原始影片網址（選填）", exact: true })
      .fill("https://www.youtube.com/watch?v=abcdefghijk");
    await queuePage.evaluate(id => {
      window.acceptance.admitGeneration(id);
      window.acceptance.holdAdmission = false;
    }, firstId);
    await queuePage.getByText("已加入佇列", { exact: true }).waitFor();
    assert.equal(
      await queuePage.getByRole("dialog").count(),
      0,
      "admission leaves the Sheet closed",
    );
    assert.equal(await titleInput.inputValue(), secondTitle);
    assert.equal(
      await queuePage.evaluate(
        id => window.acceptance.commands.find(request => request.id === id).payload.source.title,
        firstId,
      ),
      firstTitle,
    );
    await queuePage.evaluate(
      title => window.acceptance.setVideo("https://www.youtube.com/watch?v=abcdefghijk", title),
      secondTitle,
    );
    await queuePage.getByRole("button", { name: /^(取得字幕|重新取得|重試)$/ }).click();
    await queuePage.locator('[data-ui="subtitleState"][data-state="ready"]').waitFor();
    await queuePage.getByRole("button", { name: "下一步", exact: true }).click();
    await queuePage.getByRole("button", { name: "下一步", exact: true }).click();
    await wizard.locator("footer").getByRole("button", { name: "加入佇列", exact: true }).click();
    await queuePage.waitForFunction(() => window.acceptance.jobs.size === 2);
    await queuePage.waitForFunction(
      () => document.querySelector('[data-ui="activity-count"]')?.textContent === "2",
    );
    const secondId = await queuePage.evaluate(
      () => [...window.acceptance.jobs.values()].find(job => job.status === "queued").id,
    );
    assert.equal(await wizard.locator('section[aria-label="正在建立內容"]').count(), 0);
    await queuePage.evaluate(id => window.acceptance.repeatJob(id), secondId);
    assert.equal(await queuePage.getByRole("dialog").count(), 0);
    await queuePage
      .locator('[data-sonner-toast][data-front="true"]')
      .getByRole("button", { name: "查看活動", exact: true })
      .click();
    const activitySheet = queuePage.getByRole("dialog");
    await activitySheet.waitFor();
    const rows = activitySheet.locator('[data-ui="taskHistoryItem"]');
    assert.equal(await rows.count(), 2);
    assert.equal(await rows.nth(0).locator("[title]").getAttribute("title"), firstTitle);
    assert.equal(await rows.nth(1).locator("[title]").getAttribute("title"), secondTitle);
    assert.match(await rows.nth(1).textContent(), /等待序號: 1/);
    await rows.nth(0).locator("button[aria-expanded]").click();
    await rows.nth(0).getByRole("progressbar").waitFor();
    assert.equal(
      await rows.nth(0).getByRole("progressbar").getAttribute("aria-valuenow"),
      String(100 / 3),
    );
    assert.match(await rows.nth(0).textContent(), /已完成 2／6 個生成步驟/);
    assert.equal(await activitySheet.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(
      await activitySheet
        .getByRole("button", { name: "清除所有已結束紀錄", exact: true })
        .isDisabled(),
      true,
    );
    await activitySheet.evaluate(async el => {
      await Promise.all(
        el
          .getAnimations({ subtree: true })
          .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map(animation => animation.finished.catch(() => {})),
      );
    });
    await queuePage.screenshot({ path: join(output, `activity-${width}.png`) });
    await queuePage.keyboard.press("Escape");
    await activitySheet.waitFor({ state: "detached" });
    assert.equal(await queuePage.evaluate(() => document.activeElement.id), "header-activity");

    // Finish the first while the user prepares another video. The second starts next.
    await wizard.locator("nav").getByRole("button", { name: "影片", exact: true }).click();
    await titleInput.fill("Third video — unfinished draft");
    await queuePage.evaluate(id => window.acceptance.finishGeneration(id), firstId);
    await queuePage.waitForFunction(() =>
      [...window.acceptance.jobs.values()].some(job => job.status === "completed"),
    );
    assert.equal(await titleInput.inputValue(), "Third video — unfinished draft");
    assert.equal(await wizard.isVisible(), true, "completion must not navigate to the reader");
    assert.equal(await queuePage.getByRole("dialog").count(), 0);
    await queuePage.waitForFunction(
      () => document.querySelector('[data-ui="activity-count"]')?.textContent === "1",
    );
    assert.equal(await queuePage.locator('[data-ui="activity-unread"]').count(), 0);
    assert.doesNotMatch(
      await queuePage.locator("#header-activity").getAttribute("aria-label"),
      /有新活動/,
    );
    await queuePage.screenshot({ path: join(output, `create-${width}.png`) });
    await queuePage.locator("#header-activity").click();
    await activitySheet.waitFor();
    assert.equal(await queuePage.locator('[data-ui="activity-unread"]').count(), 0);
    assert.equal(await queuePage.locator('[data-ui="activity-count"]').textContent(), "1");
    assert.equal(await rows.nth(0).locator("[title]").getAttribute("title"), secondTitle);
    await rows.nth(0).locator("button[aria-expanded]").click();
    await rows.nth(0).getByRole("button", { name: "取消", exact: true }).click();
    await queuePage.waitForFunction(
      id => window.acceptance.jobs.get(id)?.status === "cancelled",
      secondId,
    );
    assert.equal(
      await queuePage.evaluate(
        id =>
          window.acceptance.commands.some(
            request => request.type === "cancel" && request.jobId === id,
          ),
        secondId,
      ),
      true,
    );
    assert.equal(
      await queuePage.evaluate(id => window.acceptance.jobs.get(id).status, firstId),
      "completed",
    );
    await queuePage.keyboard.press("Escape");
    await activitySheet.waitFor({ state: "detached" });
    await queuePage.locator("#header-activity").click();
    await activitySheet.waitFor();
    assert.equal(await rows.count(), 2, "closing and reopening retains jobs");
    await queuePage.keyboard.press("Escape");
    await activitySheet.waitFor({ state: "detached" });
    assert.equal(await queuePage.evaluate(() => document.activeElement.id), "header-activity");

    await queuePage.evaluate(() => {
      window.acceptance.failNextAdmission = true;
    });
    await queuePage.getByRole("button", { name: "下一步", exact: true }).click();
    await queuePage.getByRole("button", { name: "下一步", exact: true }).click();
    await wizard.locator("footer").getByRole("button", { name: "建立內容", exact: true }).click();
    await queuePage
      .getByText("Preview admission failed", { exact: true })
      .waitFor({ state: "attached" });
    await queuePage.locator('[data-ui="piFeedback"] summary').click();
    await queuePage.getByText("Preview admission failed", { exact: true }).waitFor();
    assert.equal(await queuePage.getByText("已加入佇列", { exact: true }).count(), 0);
    assert.equal(await queuePage.evaluate(() => window.acceptance.jobs.size), 2);
    assert.deepEqual(queueErrors, []);
    console.log(
      `PASS Activity queue ${width}px: admission, immutable draft, FIFO, progress, completion, cancellation, focus`,
    );
    await queuePage.close();
  }
  console.log("Activity screenshots:", output);
} catch (error) {
  const lastPage = browser?.contexts().at(-1)?.pages().at(-1);
  if (lastPage) {
    console.error("Activity failure UI:", await lastPage.locator("body").innerText());
    await lastPage.screenshot({ path: join(output, "failure.png") });
    console.error("Activity failure screenshot:", join(output, "failure.png"));
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
