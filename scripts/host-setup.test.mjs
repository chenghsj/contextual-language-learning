import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSetup } from "../apps/local-host/setup/server.mjs";
import { setupConfiguration } from "./package-host-setup.mjs";
import {
  browserManifestLocation,
  installationDir,
  installNativeHost,
} from "../apps/local-host/scripts/native-host-platform.mjs";

const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
test("setup packages require an explicit target and real extension identity", () => {
  assert.throws(
    () =>
      setupConfiguration({ platform: "darwin", arch: "arm64", version: "0.1.0", extensionIds: {} }),
    /real browser extension IDs/,
  );
  assert.throws(
    () => setupConfiguration({ platform: "darwin", arch: "x86", extensionIds: { chrome: id } }),
    /Unsupported/,
  );
  assert.throws(
    () => setupConfiguration({ platform: "darwin", arch: "arm64", extensionIds: { chrome: "*" } }),
    /real browser extension IDs/,
  );
  assert.equal(
    setupConfiguration({
      platform: "win32",
      arch: "arm64",
      extensionIds: { chrome: id },
      mode: "local",
    }).mode,
    "local",
  );
});

test(
  "packaged setup authenticates mutations, installs its runtime and preserves other browsers and data",
  { skip: process.platform === "win32" },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "cll-setup-api-"));
    const root = join(home, "extracted");
    const env = {
      PATH: "/no-user-node",
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
    };
    for (const folder of ["setup", "runtime", "dist"])
      await mkdir(join(root, folder), { recursive: true });
    await cp(
      new URL("../apps/local-host/setup/index.html", import.meta.url),
      join(root, "setup/index.html"),
    );
    await writeFile(join(root, "runtime/node"), "bundled runtime fixture");
    await writeFile(join(root, "dist/native-host.mjs"), "host fixture");
    await writeFile(join(root, "dist/macos-speech"), "speech helper fixture");
    await writeFile(join(root, "dist/macos-credentials"), "credential helper fixture");
    await writeFile(join(root, "dist/macos-speech.swift"), "speech helper fixture");
    await writeFile(join(root, "dist/macos-speech-siri"), "Siri helper fixture");
    await writeFile(join(root, "dist/macos-speech-siri.LICENSE"), "Siri license fixture");
    const config = setupConfiguration({
      platform: process.platform,
      arch: process.arch,
      version: "0.1.0",
      extensionIds: { chrome: id, edge: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });
    await writeFile(join(root, "setup-config.json"), JSON.stringify(config));
    const setup = await startSetup({ root, home, env, launchBrowser: false });
    const api = (action, body, token = setup.token, origin = setup.origin) =>
      fetch(setup.origin + "/api/" + action, {
        method: "POST",
        headers: { "x-setup-token": token, Origin: origin },
        body: JSON.stringify(body),
      });
    try {
      assert.equal((await api("install", { browser: "chrome" }, "wrong")).status, 403);
      assert.equal(
        (await api("install", { browser: "chrome" }, setup.token, "https://untrusted.example"))
          .status,
        403,
      );
      assert.equal((await fetch(setup.origin + "/api/state")).status, 403);
      assert.equal((await api("install", { browser: "firefox" })).status, 400);
      assert.equal(
        (
          await api("install", {
            browser: "chrome",
            extensionId: "cccccccccccccccccccccccccccccccc",
          })
        ).status,
        200,
      );
      const chrome = JSON.parse(
        await readFile(browserManifestLocation(process.platform, "chrome", home, env).path),
      );
      assert.deepEqual(
        chrome.allowed_origins,
        ["chrome-extension://" + id + "/"],
        "release mode never accepts an arbitrary caller-supplied ID",
      );
      const program = installationDir(process.platform, home, env);
      assert.equal(await readFile(join(program, "node"), "utf8"), "bundled runtime fixture");
      if (process.platform === "darwin") {
        assert.equal(
          await readFile(join(program, "macos-speech-siri"), "utf8"),
          "Siri helper fixture",
        );
        assert.equal(
          await readFile(join(program, "macos-speech-siri.LICENSE"), "utf8"),
          "Siri license fixture",
        );
      }
      const launcher = await readFile(chrome.path, "utf8");
      assert.ok(launcher.includes(join(program, "node")));
      assert.ok(!launcher.includes(process.execPath));
      assert.equal((await api("install", { browser: "edge" })).status, 200);
      const lesson = join(home, "Documents/Contextual Language Learning/data-v5/keep.json");
      const auth = join(program, "../pi/auth.json");
      for (const path of [lesson, auth]) {
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, "keep");
      }
      assert.equal((await api("uninstall", { browser: "chrome" })).status, 200);
      await access(program);
      await assert.rejects(
        access(browserManifestLocation(process.platform, "chrome", home, env).path),
        { code: "ENOENT" },
      );
      await access(browserManifestLocation(process.platform, "edge", home, env).path);
      assert.equal((await api("uninstall", { browser: "edge" })).status, 200);
      assert.equal((await api("uninstall", { browser: "edge" })).status, 200);
      await assert.rejects(access(program), { code: "ENOENT" });
      for (const path of [lesson, auth]) assert.equal(await readFile(path, "utf8"), "keep");
    } finally {
      await setup.close();
      await rm(home, { recursive: true, force: true });
    }
  },
);

test("Windows bundled install uses precompiled launcher and separate manifests for browser IDs", async () => {
  const home = await mkdtemp(join(tmpdir(), "cll-setup-win-"));
  const root = join(home, "source");
  await mkdir(root);
  for (const [name, content] of [
    ["node.exe", "node"],
    ["native-host.exe", "launcher"],
    ["native-host.mjs", "host"],
  ])
    await writeFile(join(root, name), content);
  const env = { LOCALAPPDATA: join(home, "local") };
  const commands = [];
  try {
    const options = {
      platform: "win32",
      home,
      env,
      sourceRoot: root,
      sourceEntry: join(root, "native-host.mjs"),
      bundledRuntime: join(root, "node.exe"),
      prebuiltLauncher: join(root, "native-host.exe"),
      run: async (command, args) => {
        commands.push([command, args]);
        return { stdout: "" };
      },
    };
    const chrome = await installNativeHost({ ...options, browser: "chrome", extensionId: id });
    const edge = await installNativeHost({
      ...options,
      browser: "edge",
      extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    assert.notEqual(chrome.manifestPath, edge.manifestPath);
    assert.equal(
      JSON.parse(await readFile(chrome.manifestPath)).allowed_origins[0],
      "chrome-extension://" + id + "/",
    );
    assert.ok(
      commands.every(([command]) => command === "reg.exe"),
      "no runtime compilation on the user's machine",
    );
    assert.equal(await readFile(chrome.launcher, "utf8"), "launcher");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
