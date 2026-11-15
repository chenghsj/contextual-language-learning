import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { preview } from "vite";
import { chromium } from "../../extension/node_modules/playwright/index.mjs";
import {
  captureFavorite,
  captureFavoriteCatalog,
  FavoriteRecordSchema,
  favoriteCollectionBytes,
  favoriteIdentityBytes,
} from "../../../packages/core/src/index.ts";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture.ts";
import { libraryFixture } from "../src/library-fixture.ts";
import { libraryItems, libraryContentKey } from "../src/library.ts";
import { mockYouTube } from "./fake-youtube.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = fileURLToPath(new URL("../../../.audit/favorites-web/browser/", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const account = { id: "synthetic-offline-reader", email: "offline@example.test" };
const document = pointsFixture().document;
const origin = { documentId: document.id, sceneId: document.sections[0].id };
const writerId = randomUUID();
const record = FavoriteRecordSchema.parse({
  schemaVersion: 1,
  operationId: randomUUID(),
  collectionId: hash(favoriteCollectionBytes(account.id)),
  origin,
  key: hash(favoriteIdentityBytes(origin)),
  writerId,
  version: { [writerId]: 1 },
  createdAt: document.createdAt,
  requestHash: "a".repeat(64),
  action: "add",
  snapshot: captureFavorite(document, origin.sceneId, document.createdAt, "offline-test"),
});
const source = { id: "synthetic-source", hash: hash(JSON.stringify(record)) };
const catalog = captureFavoriteCatalog(record, source);
const library = await libraryFixture();
const materials = libraryItems(library.files);
const material = materials.find(item => item.schema === "7");
const materialKey = await libraryContentKey(material);
const address = process.argv[2];
const server = address
  ? null
  : await preview({
      root,
      configFile: join(root, "vite.config.ts"),
      preview: { host: "localhost", port: 0 },
    });
let browser;
try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await mockYouTube(page);
  await context.route("https://accounts.google.com/gsi/client", route =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.google={accounts:{oauth2:{initTokenClient(config){return {requestAccessToken(options){window.__oauthRequests=Number(sessionStorage.getItem("test-oauth-requests")??0)+1;sessionStorage.setItem("test-oauth-requests",String(window.__oauthRequests));sessionStorage.setItem("test-oauth-options",JSON.stringify(options));window.__oauthUserActivation=navigator.userActivation.isActive;if(window.__rejectTestOAuth){config.error_callback();return;}config.callback({access_token:"synthetic-reconnect-token",expires_in:3600,scope:"openid email https://www.googleapis.com/auth/drive.file"});}}}}}};`,
    }),
  );
  await context.route("https://openidconnect.googleapis.com/v1/userinfo", route =>
    route.fulfill({ json: { sub: account.id, email: account.email, email_verified: true } }),
  );
  await context.route("https://www.googleapis.com/drive/v3/files**", route => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").at(-1);
    if (id === "files")
      return route.fulfill({ json: { files: library.files, incompleteSearch: false } });
    const bytes = library.bodies.get(id);
    return bytes
      ? route.fulfill({ body: Buffer.from(bytes), contentType: "application/octet-stream" })
      : route.fulfill({ status: 404 });
  });

  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(address ?? server.resolvedUrls.local[0]);
  console.log("Opened production build", page.url());
  const themeControl = page.getByRole("combobox", { name: "外觀主題" });
  await themeControl.waitFor();
  const themeBounds = await themeControl.boundingBox();
  assert.equal(themeBounds.width, 36, "production theme icon control width");
  assert.equal(themeBounds.height, 36);
  assert.equal(await themeControl.locator("svg:visible").count(), 1);
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Service Worker activation timed out")), 15000),
      ),
    ]);
    if (!navigator.serviceWorker.controller)
      await new Promise(resolve =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }),
      );
  });
  console.log("Service Worker active");
  await page.evaluate(
    async ({ account, catalog, source, record, materials, materialKey, materialDocument }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("cll-favorite-reader", 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("catalog");
          request.result.createObjectStore("content");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction(["catalog", "content"], "readwrite");
        tx.objectStore("catalog").put(
          { records: [catalog], updatedAt: "2026-10-23T00:00:00.000Z" },
          account.id,
        );
        tx.objectStore("catalog").put(
          { items: materials, updatedAt: "2026-10-23T00:00:00.000Z" },
          account.id + ":library",
        );
        tx.objectStore("content").put(
          {
            account: account.id,
            hash: "library:" + materialKey,
            snapshot: { kind: "standard", document: materialDocument, revision: materialKey },
            size: 1000,
            touched: Date.now(),
          },
          account.id + ":library:" + materialKey,
        );
        tx.objectStore("content").put(
          {
            account: account.id,
            hash: source.hash,
            snapshot: record.snapshot,
            size: 1000,
            touched: Date.now(),
          },
          account.id + ":" + source.hash,
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      localStorage.setItem("cll-favorite-account", JSON.stringify(account));
      localStorage.setItem("cll-web-layout", "list");
    },
    {
      account,
      catalog,
      source,
      record,
      materials,
      materialKey,
      materialDocument: library.document,
    },
  );
  await context.setOffline(true);
  await page.reload();
  const offlineAssets = await page.evaluate(async () => {
    const manifest = await (await fetch("/manifest.webmanifest")).json();
    const icons = await Promise.all(
      manifest.icons.map(async icon => {
        const response = await fetch(icon.src);
        const bytes = await response.arrayBuffer();
        const dimensions = new DataView(bytes);
        return {
          declared: icon.sizes,
          width: dimensions.getUint32(16),
          height: dimensions.getUint32(20),
        };
      }),
    );
    return { display: manifest.display, icons };
  });
  assert.equal(offlineAssets.display, "standalone");
  for (const icon of offlineAssets.icons)
    assert.equal(
      icon.declared,
      `${icon.width}x${icon.height}`,
      "manifest and correctly sized icons are available offline",
    );
  await page.locator(".cards > li").nth(1).waitFor();
  await page.getByRole("button", { name: "清除此帳號的本機資料", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "登出並清除本機副本", exact: true }).count(),
    0,
    "local-copy mode offers cache removal instead of sign-out",
  );
  const customRow = page.locator(".cards > li").filter({ hasText: "雲端自訂筆記" });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.getByRole("button", { name: "卡片顯示", exact: true }).click();
  await customRow.getByRole("button").click();
  await customRow.getByRole("alert").waitFor();
  const geometry = await customRow.evaluate(row => {
    const card = row.querySelector(".material-shell"),
      button = row.querySelector(".material-card"),
      title = row.querySelector("h3");
    return {
      shellScrollTop: card.scrollTop,
      button: button.getBoundingClientRect().toJSON(),
      title: title.getBoundingClientRect().toJSON(),
    };
  });
  assert.equal(geometry.shellScrollTop, 0, "feedback must not scroll the card and hide its title");
  assert.ok(
    geometry.title.top >= geometry.button.top && geometry.title.bottom <= geometry.button.bottom,
    "title stays inside the visible button",
  );
  await page.screenshot({ path: join(output, "open-error-cards-fixed.png"), fullPage: true });
  await page.getByRole("button", { name: "列表顯示", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await customRow.getByRole("alert").filter({ hasText: "尚未下載" }).waitFor();
  const feedback = await customRow.getByRole("alert").boundingBox();
  assert.ok(
    feedback.y >= 0 && feedback.y + feedback.height <= 844,
    "opening errors stay beside the clicked row and inside viewport",
  );
  assert.equal(
    await customRow.getByRole("button", { name: "連結並開啟", exact: true }).count(),
    0,
    "offline mode does not offer an unusable login action",
  );

  await page.locator(".cards > li").filter({ hasText: "完整情境教材" }).getByRole("button").click();
  await page.locator('[data-ui="unifiedReader"]').waitFor();
  await page.getByRole("button", { name: "返回內容庫" }).click();
  await page.getByRole("tab", { name: "收藏", exact: true }).click();
  await page.locator(".cards > li").waitFor();
  assert.equal(await page.locator(".cards > li").count(), 1);
  await page.locator(".cards > li button").click();
  await page.locator('[data-ui="unifiedReader"]').waitFor();
  await page.screenshot({ path: join(output, "production-offline-reader.png"), fullPage: true });
  assert.equal(await page.evaluate(() => typeof window.webAcceptance), "undefined");
  const urls = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async key =>
          (await (await caches.open(key)).keys()).map(r => r.url),
        ),
      )
    ).flat(),
  );
  assert.ok(urls.length > 1);
  assert.ok(
    urls.every(url => new URL(url).origin === new URL(page.url()).origin),
    "shell cache only holds this site's static assets",
  );
  await page.getByRole("button", { name: "返回收藏" }).click();
  await page.getByRole("tab", { name: "所有教材", exact: true }).click();
  await context.setOffline(false);
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.screenshot({ path: join(output, "local-copy-clear-action.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  // A cached lesson opens online without requiring OAuth after a reload.
  await page
    .locator(".cards > li")
    .filter({ hasText: "完整情境教材" })
    .locator(".material-card")
    .click();
  await page.locator('[data-ui="unifiedReader"]').waitFor();
  assert.equal(
    await page.evaluate(() => window.__oauthRequests ?? 0),
    0,
    "cached materials need no new authorization",
  );
  const cachedReaderAddress = page.url();
  await page.setViewportSize({ width: 1165, height: 768 });
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-slot="resizable-panel-group"]'))
        .flexDirection === "row" &&
      Math.abs(
        document.querySelector(".video-reading-content").getBoundingClientRect().width - 400,
      ) < 2,
  );
  const productionVideo = await page.locator('iframe[title^="YouTube 影片："]').boundingBox();
  const readerTheme = page.getByRole("combobox", { name: "外觀主題" });
  await readerTheme.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const focusClips = await readerTheme.evaluate(control => {
    const bounds = control.getBoundingClientRect(),
      clips = [];
    for (let parent = control.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX === "visible") continue;
      const rect = parent.getBoundingClientRect();
      if (bounds.left - 2 < rect.left || bounds.right + 2 > rect.right) clips.push(parent.tagName);
    }
    return { visible: control.matches(":focus-visible"), clips };
  });
  assert.equal(focusClips.visible, true);
  assert.deepEqual(focusClips.clips, [], "production theme focus ring is not clipped");
  console.log("Production reader theme focus ring passed");
  const productionMaterial = await page.locator(".video-reading-content").boundingBox();
  assert.ok(productionVideo.width > 1165 * 0.5, "production video uses the large left pane");
  assert.ok(
    productionMaterial.x > productionVideo.x + productionVideo.width,
    "production material is on the right",
  );
  assert.ok(Math.abs(productionMaterial.width - 400) < 2);
  const stageBounds = await page.locator(".video-stage").boundingBox();
  const readerBounds = await page.locator('[data-ui="unifiedReader"]').boundingBox();
  const toolbarBounds = await page.locator(".reading-toolbar").boundingBox();
  assert.ok(
    Math.abs(stageBounds.y - readerBounds.y) < 1,
    "production video/material top edges align",
  );
  assert.ok(Math.abs(stageBounds.x - toolbarBounds.x) < 1, "production left edges align");
  assert.ok(
    Math.abs(readerBounds.x + readerBounds.width - toolbarBounds.x - toolbarBounds.width) < 1,
    "production right edges align",
  );
  console.log("Production boundary alignment passed", {
    top: stageBounds.y - readerBounds.y,
    left: stageBounds.x - toolbarBounds.x,
    right: readerBounds.x + readerBounds.width - toolbarBounds.x - toolbarBounds.width,
  });
  const resizeHandle = page.getByRole("separator", { name: "調整教材欄寬度" });
  assert.equal(await resizeHandle.getAttribute("data-slot"), "resizable-handle");
  await resizeHandle.focus();
  await resizeHandle.press("ArrowLeft");
  const resizedMaterial = await page.locator(".video-reading-content").boundingBox();
  assert.ok(
    resizedMaterial.width > productionMaterial.width,
    "production shadcn keyboard resizing",
  );
  await resizeHandle.hover();
  const resizeGrip = await resizeHandle.boundingBox();
  await page.mouse.down();
  await page.mouse.move(resizeGrip.x - 40, resizeGrip.y + resizeGrip.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(
    before =>
      document.querySelector(".video-reading-content").getBoundingClientRect().width > before + 20,
    resizedMaterial.width,
  );
  await resizeHandle.dblclick();
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector(".video-reading-content").getBoundingClientRect().width - 400,
      ) < 2,
  );
  assert.equal(
    await page.evaluate(() => Number(localStorage.getItem("cll-reader-pane-width"))),
    400,
  );
  console.log("Production shadcn Resizable keyboard, pointer and reset passed");
  const playingRow = page
    .locator('[data-ui="sourceUtterance"]')
    .filter({
      has: page.locator('[data-ui="analysis-toggle"]'),
    })
    .last();
  await playingRow.locator('[data-ui="cue-play"]').last().click();
  await playingRow.locator('[data-ui="sourceSentence"][aria-current="true"]').waitFor();
  const disclosure = playingRow.locator('[data-ui="analysis-toggle"]');
  await disclosure.focus();
  await disclosure.press("Tab");
  await page.keyboard.press("Shift+Tab");
  if ((await disclosure.getAttribute("aria-expanded")) === "false") await disclosure.press("Enter");
  await disclosure.hover();
  const highlight = await playingRow.evaluate(row => {
    const trigger = row.querySelector('[data-ui="analysis-toggle"]');
    const current = row.querySelector('[data-ui="sourceSentence"][aria-current="true"]');
    return {
      gap: current.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom,
      triggerWidth: trigger.getBoundingClientRect().width,
      headerWidth: row.querySelector('[data-ui="analysis-source-header"]').getBoundingClientRect()
        .width,
      triggerLeft: trigger.getBoundingClientRect().left,
      sentenceLeft: current.getBoundingClientRect().left,
      numberLeft: row.querySelector('[data-ui="analysis-range"]').getBoundingClientRect().left,
      textLeft: current.querySelector('[data-ui="sentence-text"]').getBoundingClientRect().left,
      focus: getComputedStyle(trigger).boxShadow,
    };
  });
  assert.ok(highlight.gap >= 3.5, "production playing row and disclosure do not overlap");
  assert.ok(
    Math.abs(highlight.triggerWidth - highlight.headerWidth) < 1,
    "production full-row hover",
  );
  assert.ok(
    Math.abs(highlight.triggerLeft - highlight.sentenceLeft) < 1,
    "production backgrounds align",
  );
  assert.ok(
    Math.abs(highlight.numberLeft - highlight.textLeft) < 1,
    "production text left edges align",
  );
  assert.ok(highlight.focus.includes("inset"), "production keyboard focus is inset");
  await page.screenshot({ path: join(output, "production-reader-highlight.png"), fullPage: true });
  console.log("Production playing/disclosure highlight passed", highlight);
  await page.getByRole("button", { name: "收合影片", exact: true }).click();
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-ui="unifiedReader"]').getBoundingClientRect();
    const header = document.querySelector(".reading-toolbar").getBoundingClientRect();
    return Math.abs(card.left - header.left) < 1 && Math.abs(card.right - header.right) < 1;
  });
  console.log("Production collapsed material edges align with header");
  await page.screenshot({ path: join(output, "production-collapsed-reader.png"), fullPage: true });
  await page.getByRole("button", { name: "顯示影片", exact: true }).click();
  await page.goBack();
  await customRow.waitFor();
  await page.goForward();
  await page.locator('[data-ui="unifiedReader"]').waitFor();
  assert.equal(page.url(), cachedReaderAddress, "production browser forward returns to the lesson");
  await page.reload();
  await page.locator('[data-ui="unifiedReader"]').waitFor();
  assert.equal(
    page.url(),
    cachedReaderAddress,
    "production cached deep links survive reload without OAuth",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回內容庫", exact: true }).click();
  const connectAndOpen = customRow.locator(".material-card");
  await connectAndOpen.filter({ hasText: "連結並開啟" }).waitFor();
  assert.equal(
    await customRow.getByRole("alert").count(),
    0,
    "disconnected is a normal entry state, not a per-material error",
  );
  await page.evaluate(() => {
    window.__rejectTestOAuth = true;
  });
  await connectAndOpen.click();
  await customRow.getByRole("alert").filter({ hasText: "Google 連結未完成" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.__oauthRequests),
    1,
    "first click immediately requests authorization",
  );
  assert.equal(
    await page.evaluate(() => window.__oauthUserActivation),
    true,
    "Google popup runs within the user's click gesture",
  );
  await page.evaluate(() => {
    window.__rejectTestOAuth = false;
  });
  await customRow
    .locator(".entry-feedback")
    .getByRole("button", { name: "連結並開啟", exact: true })
    .click();
  await page.getByRole("article", { name: "教材內容" }).waitFor();
  assert.ok(
    (await page.getByRole("article", { name: "教材內容" }).innerText()).length > 0,
    "reconnecting resumes opening the originally clicked material",
  );
  await page.getByRole("button", { name: "返回內容庫", exact: true }).click();
  // Remove only synthetic lesson bodies so subsequent opens must use Drive, not the cache.
  async function clearMaterialBodies() {
    await page.evaluate(async accountId => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("cll-favorite-reader", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("content", "readwrite"),
          store = tx.objectStore("content");
        const keys = store.getAllKeys();
        keys.onsuccess = () =>
          keys.result
            .filter(key => String(key).startsWith(accountId + ":library:"))
            .forEach(key => store.delete(key));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, account.id);
  }
  await clearMaterialBodies();
  await page.locator(".material-card").filter({ hasText: "完整情境教材" }).click();
  await page.locator('[data-ui="unifiedReader"]').waitFor();
  assert.equal(
    await page.evaluate(() => Number(sessionStorage.getItem("test-oauth-requests"))),
    2,
    "a second different uncached lesson reuses the same authorization",
  );
  await clearMaterialBodies();
  const readerAddress = page.url();
  await page.reload();
  await page.locator('[data-ui="unifiedReader"]').waitFor();
  assert.equal(page.url(), readerAddress, "reload stays on the same material URL");
  await page.getByRole("button", { name: "返回內容庫", exact: true }).click();
  await page.getByText("已連結 · Google Drive", { exact: true }).waitFor();
  await customRow.locator(".material-card").click();
  await page.getByRole("article", { name: "教材內容" }).waitFor();
  assert.equal(
    await page.evaluate(() => Number(sessionStorage.getItem("test-oauth-requests"))),
    2,
    "reload restores the still-valid tab authorization for another uncached download",
  );
  await page.evaluate(() => {
    const value = JSON.parse(sessionStorage.getItem("cll-google-session"));
    value.expiresAt = Date.now() - 1;
    sessionStorage.setItem("cll-google-session", JSON.stringify(value));
  });
  await clearMaterialBodies();
  await page.reload();
  await page.getByRole("button", { name: "連結 Google Drive", exact: true }).waitFor();
  await page.getByRole("button", { name: "返回內容庫", exact: true }).click();
  await customRow.locator(".material-card").filter({ hasText: "連結並開啟" }).click();
  await page.getByRole("article", { name: "教材內容" }).waitFor();
  assert.equal(
    await page.evaluate(() => Number(sessionStorage.getItem("test-oauth-requests"))),
    3,
    "only expired authorization requests a new grant",
  );
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem("test-oauth-options"))),
    { prompt: "", login_hint: account.id },
    "renewal reuses the known account without forcing its chooser",
  );
  await page.getByRole("button", { name: "返回內容庫", exact: true }).click();
  const secondTab = await context.newPage();
  await secondTab.goto(page.url());
  await secondTab.getByRole("button", { name: "連結 Google Drive", exact: true }).click();
  await secondTab.getByText("已連結 · Google Drive", { exact: true }).waitFor();
  assert.ok(await secondTab.evaluate(() => sessionStorage.getItem("cll-google-session")));
  await page.getByRole("button", { name: "登出並清除本機副本" }).click();
  await secondTab.getByText("連結你的 Google Drive", { exact: true }).waitFor();
  assert.equal(
    await secondTab.evaluate(() => sessionStorage.getItem("cll-google-session")),
    null,
    "logout clears another connected tab's authorization via BroadcastChannel",
  );
  await secondTab.close();
  await page.getByText("連結你的 Google Drive", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("cll-google-session")), null);
  await page.reload();
  assert.equal(await page.locator(".cards > li").count(), 0);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "offline-result.json"),
    JSON.stringify(
      {
        productionBuild: true,
        serviceWorkerOfflineReload: true,
        indexedDBOfflineRead: true,
        logout: true,
        offlineManifestAndIcons: true,
        inlineOpenError: true,
        reconnectResumesMaterial: true,
        uncachedMaterialConnectsOnFirstClick: true,
        cachedMaterialSkipsOAuth: true,
        popupKeepsUserActivation: true,
        multipleUncachedMaterialsReuseAuthorization: true,
        reloadRestoresValidAuthorization: true,
        expiredAuthorizationRenewsWithAccountHint: true,
        logoutClearsAuthorization: true,
        crossTabLogoutClearsAuthorization: true,
        productionLargeVideoLeftAndMaterialRight: true,
        nativeBackForwardAndCachedDeepLinkReload: true,
        cardTitleSurvivesFeedback: true,
        realGoogleOAuth: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS production offline reload, inline opening errors, reconnect-and-open, IndexedDB read and logout",
  );
  await context.close();
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
