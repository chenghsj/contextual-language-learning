import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  browserManifestLocation,
  installationDir,
  uninstallNativeHost,
  HOST_NAME,
} from "./native-host-platform.mjs";

test("Native Host installer selects per-browser and per-OS registration locations", () => {
  const home = process.platform === "win32" ? "C:\\Users\\sample" : "/home/sample";
  assert.equal(
    browserManifestLocation("win32", "chrome", home).key,
    "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST_NAME,
  );
  assert.equal(
    browserManifestLocation("win32", "edge", home).key,
    "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\" + HOST_NAME,
  );
  assert.equal(
    browserManifestLocation("win32", "chromium", home).key,
    "HKCU\\Software\\Chromium\\NativeMessagingHosts\\" + HOST_NAME,
  );
  assert.equal(
    browserManifestLocation("darwin", "edge", home).path,
    join(
      home,
      "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
      HOST_NAME + ".json",
    ),
  );
  assert.equal(
    browserManifestLocation("linux", "chromium", home, {}).path,
    join(home, ".config/chromium/NativeMessagingHosts", HOST_NAME + ".json"),
  );
  assert.equal(
    browserManifestLocation("linux", "chrome", home, {}).path,
    join(home, ".config/google-chrome/NativeMessagingHosts", HOST_NAME + ".json"),
  );
  assert.equal(
    installationDir("linux", home, {}),
    join(home, ".local/share/immersive-language-learning/native-host"),
  );
  assert.equal(
    installationDir("win32", home, {}),
    join(home, "AppData/Local/Immersive Learning/native-host"),
  );
  assert.throws(() => browserManifestLocation("linux", "firefox", home), /Browser must/);
  assert.throws(() => installationDir("freebsd", home), /Unsupported/);
});

for (const platform of ["darwin", "linux"]) {
  test(
    platform +
      " uninstall preserves other browsers and user data, removes the last shared program, and is repeatable",
    async () => {
      const home = await mkdtemp(join(tmpdir(), "immersive-uninstall-"));
      const env = { XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data") };
      const root = installationDir(platform, home, env);
      const chrome = browserManifestLocation(platform, "chrome", home, env).path;
      const edge = browserManifestLocation(platform, "edge", home, env).path;
      const credentials = join(root, "..", "pi", "auth.json");
      const lesson = join(home, "Documents", "Immersive Learning", "data-v5", "lesson.json");
      try {
        for (const path of [
          root,
          join(root, "..", "pi"),
          join(lesson, ".."),
          join(chrome, ".."),
          join(edge, ".."),
        ]) {
          await mkdir(path, { recursive: true });
        }
        await writeFile(join(root, "native-host.mjs"), "host");
        await writeFile(chrome, "chrome");
        await writeFile(edge, "edge");
        await writeFile(credentials, "saved login");
        await writeFile(lesson, "saved lesson");
        const first = await uninstallNativeHost({ platform, browser: "chrome", home, env });
        assert.deepEqual(first.remainingBrowsers, ["edge"]);
        assert.equal(first.programRemoved, false);
        await assert.rejects(access(chrome), { code: "ENOENT" });
        assert.equal(await readFile(edge, "utf8"), "edge");
        assert.equal(await readFile(join(root, "native-host.mjs"), "utf8"), "host");
        const last = await uninstallNativeHost({ platform, browser: "edge", home, env });
        assert.equal(last.programRemoved, true);
        await assert.rejects(access(root), { code: "ENOENT" });
        await assert.rejects(access(edge), { code: "ENOENT" });
        await uninstallNativeHost({ platform, browser: "edge", home, env });
        assert.equal(await readFile(credentials, "utf8"), "saved login");
        assert.equal(await readFile(lesson, "utf8"), "saved lesson");
        await assert.rejects(
          uninstallNativeHost({ platform, browser: "firefox", home, env }),
          /Browser must/,
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );
}

test("Windows uninstall queries registrations before deleting only the selected key and last shared program", async () => {
  const home = await mkdtemp(join(tmpdir(), "immersive-uninstall-windows-"));
  const env = { LOCALAPPDATA: join(home, "local") };
  const root = installationDir("win32", home, env);
  const registrations = new Set(["chrome", "edge"]);
  const deleted = [];
  const run = async (command, args) => {
    if (command === "powershell.exe") {
      const script = args.at(-1);
      assert.match(script, /\$ErrorActionPreference = 'Stop'/);
      const browser = script.includes("Microsoft")
        ? "edge"
        : script.includes("Chromium")
          ? "chromium"
          : "chrome";
      return { stdout: registrations.has(browser) ? "True\r\n" : "False\r\n" };
    }
    assert.equal(command, "reg.exe");
    const browser = args[1].includes("Microsoft") ? "edge" : "chrome";
    assert.deepEqual(args, [
      "delete",
      browserManifestLocation("win32", browser, home, env).key,
      "/f",
    ]);
    deleted.push(browser);
    registrations.delete(browser);
    return { stdout: "" };
  };
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "native-host.exe"), "program");
    const first = await uninstallNativeHost({
      platform: "win32",
      browser: "chrome",
      home,
      env,
      run,
    });
    assert.equal(first.programRemoved, false);
    assert.deepEqual(deleted, ["chrome"]);
    await access(root);
    await assert.rejects(
      uninstallNativeHost({
        platform: "win32",
        browser: "edge",
        home,
        env,
        run: async () => {
          throw new Error("Registry read denied");
        },
      }),
      /Registry read denied/,
    );
    assert.deepEqual(deleted, ["chrome"]);
    await access(root);
    await uninstallNativeHost({ platform: "win32", browser: "edge", home, env, run });
    assert.deepEqual(deleted, ["chrome", "edge"]);
    await assert.rejects(access(root), { code: "ENOENT" });
    await uninstallNativeHost({ platform: "win32", browser: "edge", home, env, run });
    assert.deepEqual(deleted, ["chrome", "edge"], "absent keys must not be deleted again");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("uninstall CLI rejects invalid browser arguments without changing registrations", async () => {
  const home = await mkdtemp(join(tmpdir(), "immersive-uninstall-cli-"));
  const execute = promisify(execFile);
  const script = fileURLToPath(new URL("./uninstall-host.mjs", import.meta.url));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: join(home, "local"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
  };
  const manifest = browserManifestLocation(process.platform, "chrome", home, env);
  try {
    if (manifest.type === "file") {
      await mkdir(join(manifest.path, ".."), { recursive: true });
      await writeFile(manifest.path, "keep registration");
    }
    for (const args of [
      ["--browser", "firefox"],
      ["--unknown"],
      ["--browser", "chrome", "extra"],
    ]) {
      await assert.rejects(
        execute(process.execPath, [script, ...args], { env }),
        error => error.code === 1 && /Usage:/.test(error.stderr),
      );
    }
    if (manifest.type === "file")
      assert.equal(await readFile(manifest.path, "utf8"), "keep registration");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test(
  "uninstall CLI supports a selected browser and defaults to Chrome in an isolated home",
  { skip: process.platform === "win32" },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "immersive-uninstall-cli-success-"));
    const execute = promisify(execFile);
    const script = fileURLToPath(new URL("./uninstall-host.mjs", import.meta.url));
    const env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
    };
    const root = installationDir(process.platform, home, env);
    try {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, "native-host.mjs"), "program");
      for (const browser of ["chrome", "edge"]) {
        const path = browserManifestLocation(process.platform, browser, home, env).path;
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, "registration");
      }
      const first = await execute(process.execPath, [script, "--browser=edge"], { env });
      assert.match(first.stdout, /registration for edge/);
      assert.match(first.stdout, /Kept the shared Host program for: chrome/);
      await access(root);
      const last = await execute(process.execPath, [script], { env });
      assert.match(last.stdout, /registration for chrome/);
      assert.match(last.stdout, /Removed the Host program/);
      await assert.rejects(access(root), { code: "ENOENT" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
);
