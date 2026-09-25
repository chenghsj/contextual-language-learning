import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { browserManifestLocation, installationDir, HOST_NAME } from "./native-host-platform.mjs";

test("Native Host installer selects per-browser and per-OS registration locations", () => {
  const home = process.platform === "win32" ? "C:\\Users\\sample" : "/home/sample";
  assert.equal(browserManifestLocation("win32", "chrome", home).key,
    "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\" + HOST_NAME);
  assert.equal(browserManifestLocation("win32", "edge", home).key,
    "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\" + HOST_NAME);
  assert.equal(browserManifestLocation("win32", "chromium", home).key,
    "HKCU\\Software\\Chromium\\NativeMessagingHosts\\" + HOST_NAME);
  assert.equal(browserManifestLocation("darwin", "edge", home).path,
    join(home, "Library/Application Support/Microsoft Edge/NativeMessagingHosts", HOST_NAME + ".json"));
  assert.equal(browserManifestLocation("linux", "chromium", home, {}).path,
    join(home, ".config/chromium/NativeMessagingHosts", HOST_NAME + ".json"));
  assert.equal(browserManifestLocation("linux", "chrome", home, {}).path,
    join(home, ".config/google-chrome/NativeMessagingHosts", HOST_NAME + ".json"));
  assert.equal(installationDir("linux", home, {}),
    join(home, ".local/share/immersive-language-learning/native-host"));
  assert.equal(installationDir("win32", home, {}),
    join(home, "AppData/Local/Immersive Learning/native-host"));
  assert.throws(() => browserManifestLocation("linux", "firefox", home), /Browser must/);
  assert.throws(() => installationDir("freebsd", home), /Unsupported/);
});
