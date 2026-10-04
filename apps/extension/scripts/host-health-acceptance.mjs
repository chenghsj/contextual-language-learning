// Run after building Host: node --import tsx apps/extension/scripts/host-health-acceptance.mjs
// Production installer/Host with a filesystem-backed browser adapter; no real user registration changes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATION_CONTROLLER_PORT,
  installGenerationController,
} from "../src/native/generation-controller.ts";
import {
  browserManifestLocation,
  installNativeHost,
  uninstallNativeHost,
} from "../../local-host/scripts/native-host-platform.mjs";

if (process.platform === "win32") {
  console.log("SKIP isolated Windows registration: HOME does not redirect HKCU; use Windows CI.");
  process.exit(0);
}
const home = await mkdtemp(join(tmpdir(), "cll-live-uninstall-"));
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_DATA_HOME: join(home, "data"),
};
const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sourceRoot = fileURLToPath(new URL("../../local-host/", import.meta.url));
const children = [];
const replies = new Map();
function event() {
  const listeners = [];
  return {
    addListener: fn => listeners.push(fn),
    fire: value => listeners.forEach(fn => fn(value)),
  };
}
const onConnect = event();
const runtime = {
  id,
  onConnect,
  getManifest: () => ({ version: "0.1.0" }),
  connectNative() {
    const manifest = JSON.parse(
      readFileSync(browserManifestLocation(process.platform, "chrome", home, env).path, "utf8"),
    );
    const child = spawn(manifest.path, [], { env, stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    const onMessage = event(),
      onDisconnect = event();
    let buffer = Buffer.alloc(0),
      closed = false;
    child.stdout.on("data", data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const size = buffer.readUInt32LE(0);
        const value = JSON.parse(buffer.subarray(4, size + 4).toString());
        buffer = buffer.subarray(size + 4);
        onMessage.fire(value);
      }
    });
    child.on("error", () => onDisconnect.fire());
    child.on("exit", () => {
      if (!closed) onDisconnect.fire();
    });
    return {
      onMessage,
      onDisconnect,
      postMessage(value) {
        const body = Buffer.from(JSON.stringify(value)),
          header = Buffer.alloc(4);
        header.writeUInt32LE(body.length);
        child.stdin.write(Buffer.concat([header, body]));
      },
      disconnect() {
        closed = true;
        child.stdin.end();
      },
    };
  },
  sendNativeMessage(name, request, callback) {
    try {
      const port = runtime.connectNative(name);
      port.onMessage.addListener(value => {
        callback(value);
        port.disconnect();
      });
      port.postMessage(request);
    } catch (error) {
      runtime.lastError = { message: error.message };
      callback(undefined);
      runtime.lastError = undefined;
    }
  },
};
const panel = {
  name: GENERATION_CONTROLLER_PORT,
  sender: { id, url: `chrome-extension://${id}/sidepanel.html` },
  onMessage: event(),
  onDisconnect: event(),
  postMessage(value) {
    replies.get(value.id)?.(value);
  },
  disconnect() {
    panel.onDisconnect.fire();
  },
};
function request(type) {
  const requestId = randomUUID();
  return new Promise(resolve => {
    replies.set(requestId, value => {
      replies.delete(requestId);
      resolve(value);
    });
    panel.onMessage.fire({ id: requestId, type });
  });
}
const deadline = setTimeout(() => {
  for (const child of children) child.kill();
  throw new Error("Live uninstall acceptance timed out");
}, 15_000);
try {
  await installNativeHost({
    platform: process.platform,
    browser: "chrome",
    extensionId: id,
    home,
    env,
    sourceRoot,
    sourceEntry: join(sourceRoot, "dist/native-host.mjs"),
    nodePath: process.execPath,
  });
  installGenerationController(runtime);
  onConnect.fire(panel);
  panel.onMessage.fire({ type: "watch" });
  assert.equal((await request("health")).type, "health");
  assert.equal((await request("listJobs")).type, "jobs");
  const live = children.at(-1);
  await uninstallNativeHost({ platform: process.platform, browser: "chrome", home, env });
  await assert.rejects(
    access(browserManifestLocation(process.platform, "chrome", home, env).path),
    { code: "ENOENT" },
  );
  assert.equal(
    (await request("health")).type,
    "error",
    "uninstalled Host must not be reported connected",
  );
  assert.equal(live.exitCode, null, "health check must not terminate the existing Host");
  assert.equal(
    (await request("listJobs")).type,
    "jobs",
    "existing production process still responds after uninstall",
  );
  console.log(
    "PASS production Host remains alive after uninstall; fresh health fails; worker preserves existing connection.",
  );
} finally {
  clearTimeout(deadline);
  panel.disconnect();
  for (const child of children) child.kill();
  await rm(home, { recursive: true, force: true });
}
