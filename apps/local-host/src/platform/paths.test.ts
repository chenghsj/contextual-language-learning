import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { appConfigRoot, defaultDocumentsFolder } from "./paths";

test("app config strategy preserves macOS paths and chooses native Windows/Linux user folders", () => {
  const home = process.platform === "win32" ? "C:\\Users\\test" : "/home/test";
  assert.equal(appConfigRoot("darwin", {}, home),
    join(home, "Library", "Application Support", "Immersive Learning"));
  assert.equal(appConfigRoot("win32", {}, home),
    join(home, "AppData", "Roaming", "Immersive Learning"));
  assert.equal(appConfigRoot("linux", {}, home),
    join(home, ".config", "immersive-language-learning"));
  const custom = process.platform === "win32" ? "C:\\Data" : "/var/tmp/user";
  assert.equal(appConfigRoot("linux", { XDG_CONFIG_HOME: custom }, home),
    join(custom, "immersive-language-learning"));
  assert.equal(defaultDocumentsFolder(home), join(home, "Documents", "Immersive Learning"));
  assert.throws(() => appConfigRoot("freebsd", {}, home), /Unsupported/);
});
