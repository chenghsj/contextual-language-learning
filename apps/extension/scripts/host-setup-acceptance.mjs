import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  browserManifestLocation,
  installationDir,
} from "../../local-host/scripts/native-host-platform.mjs";

const run = promisify(execFile);
const psQuote = value => "\'" + value.replaceAll("\'", "\'\'") + "\'";
const project = fileURLToPath(new URL("../../..", import.meta.url));
const { version } = JSON.parse(await readFile(join(project, "package.json")));
const os = { darwin: "macos", win32: "windows", linux: "linux" }[process.platform];
const archive = process.argv[2]
  ? resolve(process.argv[2])
  : join(
      project,
      `release-assets/contextual-language-learning-${os}-${process.arch}-setup-${version}-local.zip`,
    );
if (process.platform === "win32" && !process.env.CI)
  throw new Error(
    "Windows HKCU cannot be redirected with HOME. Run this acceptance only on a disposable Windows CI runner.",
  );
const home = await mkdtemp(join(tmpdir(), "cll-packaged-setup-"));
const extracted = join(home, "extracted");
await mkdir(extracted);
const platform = process.platform;
if (platform === "win32") {
  await run("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Expand-Archive -LiteralPath " + psQuote(archive) + " -DestinationPath " + psQuote(extracted),
  ]);
} else await run("unzip", ["-q", archive, "-d", extracted]);
const root =
  platform === "darwin" ? join(extracted, "CLL 本機服務.app/Contents/Resources") : extracted;
const node = join(root, "runtime", platform === "win32" ? "node.exe" : "node");
if (platform === "linux" && process.env.CI) {
  await run("desktop-file-validate", [join(root, "CLL Setup.desktop")]);
}
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_DATA_HOME: join(home, "data"),
  ...(platform === "win32" ? {} : { PATH: "/usr/bin:/bin" }),
};
const config = JSON.parse(await readFile(join(root, "setup-config.json")));
assert.equal((await run(node, ["--version"], { env })).stdout.trim(), "v" + config.nodeVersion);
if (platform === "darwin") {
  // LaunchServices is the same native app entry point Finder uses on double-click.
  const stdout = join(home, "native-launch.stdout");
  const stderr = join(home, "native-launch.stderr");
  await writeFile(stdout, "", { mode: 0o600 });
  await writeFile(stderr, "", { mode: 0o600 });
  await run("/usr/bin/open", [
    "-n",
    "-g",
    "--env",
    "HOME=" + home,
    "--env",
    "PATH=/usr/bin:/bin",
    "--stdout",
    stdout,
    "--stderr",
    stderr,
    join(extracted, "CLL 本機服務.app"),
    "--args",
    "--no-browser",
  ]);
  let nativeUrl;
  for (let attempt = 0; attempt < 30; attempt++) {
    const value = (await readFile(stdout, "utf8")).trim();
    if (value.startsWith("http://127.0.0.1:")) {
      nativeUrl = new URL(value);
      break;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  assert.ok(nativeUrl, "Native app launch failed: " + (await readFile(stderr, "utf8")));
  const response = await fetch(nativeUrl.origin + "/api/state", {
    headers: { "x-setup-token": nativeUrl.hash.slice(1) },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, config.version);
  await fetch(nativeUrl.origin + "/api/close", {
    method: "POST",
    headers: { "x-setup-token": nativeUrl.hash.slice(1), Origin: nativeUrl.origin },
    body: "{}",
  });
  console.log("PASS native macOS app launch via LaunchServices with no user Node on PATH");
}
const moduleUrl = pathToFileURL(join(root, "setup/server.mjs")).href;
const code = `import {startSetup} from ${JSON.stringify(moduleUrl)}; const app = await startSetup({root:${JSON.stringify(root)},launchBrowser:false}); process.stdout.write(app.url + "\\n");`;
const child = spawn(node, ["--input-type=module", "-e", code], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let errors = "";
child.stderr.on("data", data => {
  errors += data;
});
const url = await new Promise((resolveUrl, reject) => {
  const timeout = setTimeout(() => reject(new Error("Setup did not start: " + errors)), 15_000);
  child.once("error", reject);
  child.once("exit", code => {
    clearTimeout(timeout);
    reject(new Error("Setup exited " + code + ": " + errors));
  });
  child.stdout.once("data", data => {
    clearTimeout(timeout);
    resolveUrl(String(data).trim());
  });
});
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 400, height: 760 } });
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(url);
  await page.getByRole("button", { name: "安裝本機服務", exact: true }).waitFor();
  assert.equal(
    await page.locator("#testing").getAttribute("hidden"),
    config.mode === "local" ? null : "",
  );
  assert.doesNotMatch(await page.locator("main").innerText(), /pnpm|scripts\/|Node\.js|終端機指令/);
  const program = installationDir(platform, home, env);
  const lesson = join(home, "Documents/Contextual Language Learning/data-v5/keep.json");
  const auth = join(program, "../pi/auth.json");
  for (const path of [lesson, auth]) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "keep");
  }
  let installedLauncher;
  for (const candidate of ["chrome", "edge"]) {
    await page.selectOption("#browser", candidate);
    await page.locator("#install").click();
    await page.getByRole("status").filter({ hasText: "安裝完成。" }).waitFor();
    const launcher =
      platform === "win32"
        ? JSON.parse(
            await readFile(join(program, candidate + "-dev.contextual.language_learning.json")),
          ).path
        : JSON.parse(await readFile(browserManifestLocation(platform, candidate, home, env).path))
            .path;
    installedLauncher = launcher;
    // Real framed requests through the installed launcher, independent of the extracted ZIP.
    await run(
      process.execPath,
      [join(project, "apps/local-host/scripts/smoke-host.mjs"), launcher],
      {
        env,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      },
    );
    await page.locator("#install").click();
    await page.getByRole("status").filter({ hasText: "安裝完成。" }).waitFor();
    console.log("PASS packaged UI installs/updates real Host with bundled runtime", candidate);
  }
  // Delete the package's runtime: the installed Host must remain independent.
  await rm(node);
  const nativeLauncher = installedLauncher;
  await run(
    process.execPath,
    [join(project, "apps/local-host/scripts/smoke-host.mjs"), nativeLauncher],
    {
      env,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  for (const candidate of ["chrome", "edge"]) {
    await page.selectOption("#browser", candidate);
    await page.locator("#uninstall").click();
    await page.getByRole("status").filter({ hasText: "解除安裝完成。" }).waitFor();
    if (candidate === "chrome") await access(program);
  }
  await assert.rejects(access(program), { code: "ENOENT" });
  for (const path of [lesson, auth]) assert.equal(await readFile(path, "utf8"), "keep");
  await page.screenshot({ path: join(home, "setup-verified.png") });
  assert.deepEqual(pageErrors, []);
  await page.locator("#close").click();
  await page.getByRole("status").filter({ hasText: "設定已結束" }).waitFor();
  console.log(
    "PASS uninstall retains other browser, lessons and sign-ins; extracted runtime is unnecessary after install",
  );
  console.log("Evidence:", home);
} finally {
  await browser?.close();
  child.kill();
  // Keep screenshots and extraction for review, not real user registrations.
}
