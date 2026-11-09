import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

// Real App + worker with one deliberately silent, read-only Host request.
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: root + "/vite.config.ts",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const [width, theme] of [
    [320, "light"],
    [550, "dark"],
  ]) {
    for (const stalled of ["listLessons", "listCustomDocuments", "listDriveLessons"]) {
      const page = await browser.newPage({
        viewport: { width, height: 850 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/dev/redesign-preview.tsx", async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace(
          "    switch (request.type) {",
          `    if (request.type === ${JSON.stringify(stalled)} && !window.catalogRecovered) return;
    if (request.type === "listCustomDocuments") {
      reply({type:"customDocuments",documents:[{
        kind:"custom",documentId:"00000000-0000-4000-8000-0000000000cf",
        title:"Local custom notes",createdAt:"2026-01-01T00:00:00Z",sourceTitle:"Fixture video"
      }]}); return;
    }
    if (request.type === "listDriveLessons") { reply({type:"driveLessons",lessons:[]}); return; }
    if (request.type === "listCustomDriveDocuments") { reply({type:"customDriveDocuments",documents:[]}); return; }
    switch (request.type) {`,
        );
        await route.fulfill({ response, body });
      });
      await page.clock.install();
      await page.goto(
        server.resolvedUrls.local[0] + `dev/redesign-preview.html?drive=1&theme=${theme}`,
      );
      await page.locator("#page-nav-lessons").click();
      await page.waitForFunction(
        type => window.acceptance.commands.some(command => command.type === type),
        stalled,
      );
      await page.locator('[data-ui="library-entry"]').first().waitFor();
      await page.clock.fastForward(31_000);
      const notice = page.locator('[data-ui="library-error"]');
      await notice.waitFor();
      await notice.getByRole("button", { name: "查看詳細資料", exact: true }).click();
      assert.match(await notice.locator("pre").textContent(), /timed out/);
      assert.equal(
        await notice.getByRole("button", { name: "重試", exact: true }).isEnabled(),
        true,
      );
      await page.evaluate(() => {
        window.catalogRecovered = true;
      });
      await notice.getByRole("button", { name: "重試", exact: true }).click();
      await notice.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "重新整理", exact: true }).waitFor();
      assert.ok(await page.locator('[data-ui="library-entry"]').count());
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/library-load-${stalled}-${width}-${theme}.png` });
      console.log(`PASS ${stalled} timeout, partial content and retry ${width} ${theme}`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
