import { chromium } from "playwright";
import { createServer } from "vite";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  browserManifestLocation,
  installationDir,
} from "../../local-host/scripts/native-host-platform.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const project = resolve(root, "../..");
const output = await mkdtemp(join(tmpdir(), "cll-uninstall-ui-"));
const server = await createServer({
  root,
  configFile: join(root, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5180, strictPort: true, hmr: false, watch: null },
});
const run = promisify(execFile);

async function executeCopiedCommand(command, browser) {
  // Windows HKCU is not redirected by HOME; real Windows execution is covered in CI.
  if (process.platform === "win32") return;
  const home = await mkdtemp(join(tmpdir(), "cll-ui-command-real-"));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
  };
  const program = installationDir(process.platform, home, env);
  const credentials = join(program, "../pi/auth.json");
  const lesson = join(home, "Documents/Immersive Learning/data-v5/keep.json");
  try {
    for (const path of [credentials, lesson]) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "retained");
    }
    await run(
      process.execPath,
      ["scripts/install-host.mjs", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "--browser", browser],
      { cwd: project, env },
    );
    await run(process.execPath, command.slice(5).split(" "), { cwd: project, env });
    await assert.rejects(access(program), { code: "ENOENT" });
    await assert.rejects(
      access(browserManifestLocation(process.platform, browser, home, env).path),
      { code: "ENOENT" },
    );
    assert.equal(await readFile(credentials, "utf8"), "retained");
    assert.equal(await readFile(lesson, "utf8"), "retained");
    await run(process.execPath, command.slice(5).split(" "), { cwd: project, env });
    console.log(
      "PASS copied UI command against production Host in isolated",
      browser,
      "registration; data retained; repeat succeeds",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  for (const width of [320, 400, 900])
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width, height: 700 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        window.copiedCommands = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async value => window.copiedCommands.push(value) },
        });
      });
      await page.goto("http://127.0.0.1:5180/dev/redesign-preview.html?theme=" + theme);
      await page.locator("#header-settings").click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^本機服務/ })
        .click();
      const section = page.locator("[data-ui=hostUninstall]");
      await section.getByRole("button", { name: "解除安裝 Host", exact: true }).click();
      assert.equal(await section.getByRole("combobox").count(), 1);
      assert.equal(await section.getByRole("button", { name: /Host 下載/ }).count(), 0);
      assert.ok((await section.boundingBox()).height < 340);
      for (const [name, flag] of [
        ["Chrome", ""],
        ["Edge", " --browser edge"],
        ["Chromium", " --browser chromium"],
      ]) {
        await section.getByRole("combobox").click();
        await page.getByRole("option", { name, exact: true }).click();
        await section.getByRole("button", { name: "複製解除安裝指令", exact: true }).click();
        const command = await page.evaluate(() => window.copiedCommands.at(-1));
        assert.equal(command, "node scripts/uninstall-host.mjs" + flag);
        if (width === 320 && theme === "light")
          await executeCopiedCommand(command, name.toLowerCase());
      }
      await section.screenshot({ path: join(output, `uninstall-${width}-${theme}.png`) });
      const connection = page.locator("[data-ui=hostConnection]");
      await connection.getByRole("status").first().getByText("已連線", { exact: true }).waitFor();
      await page.evaluate(() => {
        // New connections fail after uninstall; existing fixture ports keep replying.
        window.acceptance.hostRegistered = false;
      });
      await connection.getByRole("button", { name: "檢查連線", exact: true }).click();
      await connection.getByRole("status").first().getByText("尚未連線", { exact: true }).waitFor();
      assert.equal(await connection.getByText("Host 版本: 0.1.0", { exact: true }).count(), 0);
      assert.equal(await page.getByText("檢查完成，Host 已連線。", { exact: true }).count(), 0);
      await connection.screenshot({
        path: join(output, `uninstalled-status-${width}-${theme}.png`),
      });
      await page.evaluate(() => {
        window.acceptance.hostRegistered = true;
      });
      await connection.getByRole("button", { name: "檢查連線", exact: true }).click();
      await connection.getByRole("status").first().getByText("已連線", { exact: true }).waitFor();
      await page.getByRole("dialog").getByRole("button", { name: "關閉", exact: true }).click();
      await page.evaluate(() => {
        window.acceptance.hostRegistered = false;
        window.acceptance.disconnectHost();
      });
      const failure = page.getByRole("status").filter({ hasText: "連線失敗，請重新連線。" });
      await failure.waitFor();
      await page.evaluate(() => {
        window.acceptance.hostRegistered = true;
      });
      await failure.getByRole("button", { name: "重試", exact: true }).click();
      await page.getByText("檢查完成，Host 已連線。", { exact: true }).waitFor();
      await failure.waitFor({ state: "detached" });
      assert.equal(await page.getByText("連線失敗，請重新連線。", { exact: true }).count(), 0);
      await page.screenshot({ path: join(output, `retry-success-${width}-${theme}.png`) });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      assert.deepEqual(errors, []);
      await page.close();
      console.log(
        "PASS compact UI, uninstall/reinstall and retry clears failure status",
        width,
        theme,
      );
    }
  console.log("Evidence:", output);
} finally {
  await browser?.close();
  await server.close();
}
