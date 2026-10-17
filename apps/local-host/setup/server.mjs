import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  browserManifestLocation,
  installNativeHost,
  uninstallNativeHost,
} from "../scripts/native-host-platform.mjs";

const browsers = ["chrome", "edge", "chromium"];
const validId = value => typeof value === "string" && /^[a-p]{32}$/.test(value);
const exec = promisify(execFile);

/** A short-lived loopback setup UI, never a persistent Host daemon. */
export async function startSetup({
  root,
  home,
  env = process.env,
  launchBrowser = true,
  idleMs = 15 * 60_000,
} = {}) {
  const config = JSON.parse(await readFile(join(root, "setup-config.json"), "utf8"));
  if (config.platform !== process.platform || config.arch !== process.arch) {
    throw new Error("請下載符合這台電腦作業系統與處理器的安裝包。");
  }
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(16).toString("base64");
  const html = (await readFile(join(root, "setup/index.html"), "utf8")).replaceAll(
    "__NONCE__",
    nonce,
  );
  let origin;
  let busy = false;
  let deadline;
  function touch() {
    clearTimeout(deadline);
    deadline = setTimeout(() => server.close(), idleMs);
    deadline.unref();
  }
  async function registrations() {
    const installed = {};
    for (const browser of browsers) {
      const location = browserManifestLocation(process.platform, browser, home, env);
      if (location.type === "file") {
        try {
          await access(location.path);
          installed[browser] = true;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          installed[browser] = false;
        }
      } else {
        const path = "Registry::HKEY_CURRENT_USER" + location.key.slice("HKCU".length);
        const result = await exec(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "Test-Path -LiteralPath '" + path + "'"],
          { timeout: 10_000, windowsHide: true },
        );
        installed[browser] = result.stdout.trim().toLowerCase() === "true";
      }
    }
    return installed;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
    const reply = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(value));
    };
    if (req.headers.host !== new URL(origin).host)
      return reply(403, { error: "Invalid setup address" });
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (
      req.headers["x-setup-token"] !== token ||
      (req.headers.origin && req.headers.origin !== origin) ||
      (req.method === "POST" && req.headers.origin !== origin)
    ) {
      return reply(403, { error: "請重新開啟安裝程式。" });
    }
    touch();
    try {
      if (req.url === "/api/state" && req.method === "GET") {
        return reply(200, { ...config, installed: await registrations() });
      }
      if (
        req.method !== "POST" ||
        !["/api/install", "/api/uninstall", "/api/close"].includes(req.url)
      ) {
        return reply(404, { error: "Not found" });
      }
      if (busy) return reply(409, { error: "請等待目前操作完成。" });
      if (req.url === "/api/close") {
        reply(200, { ok: true });
        server.close();
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) return reply(413, { error: "Invalid setup request" });
      }
      const input = JSON.parse(body);
      if (!browsers.includes(input.browser)) return reply(400, { error: "請選擇瀏覽器。" });
      const extensionId =
        config.mode === "local" && input.extensionId
          ? input.extensionId
          : config.extensionIds[input.browser];
      if (req.url === "/api/install" && !validId(extensionId)) {
        return reply(400, { error: "此瀏覽器尚未設定擴充功能。請在測試設定填入擴充功能 ID。" });
      }
      busy = true;
      clearTimeout(deadline);
      try {
        if (req.url === "/api/install") {
          await installNativeHost({
            browser: input.browser,
            extensionId,
            home,
            env,
            sourceRoot: root,
            sourceEntry: join(root, "dist/native-host.mjs"),
            bundledRuntime: join(
              root,
              "runtime",
              process.platform === "win32" ? "node.exe" : "node",
            ),
            bundleKey: config.revision,
            prebuiltLauncher:
              process.platform === "win32" ? join(root, "native-host.exe") : undefined,
          });
        } else {
          const result = await uninstallNativeHost({ browser: input.browser, home, env });
          if (result.cleanupPending) {
            reply(200, { ok: true, cleanupPending: true, installed: await registrations() });
            return;
          }
        }
        reply(200, { ok: true, installed: await registrations() });
      } finally {
        busy = false;
        touch();
      }
    } catch (error) {
      // Filesystem errors are useful here but never contain provider credentials.
      reply(500, {
        error: error instanceof Error ? error.message : "操作失敗，請重新開啟安裝程式。",
      });
    }
  });
  server.on("close", () => clearTimeout(deadline));
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + "/#" + token;
  touch();
  if (launchBrowser) {
    const command =
      process.platform === "darwin"
        ? "/usr/bin/open"
        : process.platform === "win32"
          ? "rundll32.exe"
          : "xdg-open";
    const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => server.close());
    child.unref();
  }
  return {
    url,
    origin,
    token,
    close: () => new Promise(resolveClose => server.close(resolveClose)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const noBrowser = process.argv.includes("--no-browser");
    const setup = await startSetup({
      root: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      launchBrowser: !noBrowser,
    });
    if (noBrowser) process.stdout.write(setup.url + "\n");
  } catch (error) {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  }
}
