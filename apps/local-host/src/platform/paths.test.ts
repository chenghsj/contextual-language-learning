import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { appConfigRoot, defaultDocumentsFolder } from "./paths";

test("app config strategy uses the current product name on macOS and chooses native Windows/Linux user folders", () => {
  const home = process.platform === "win32" ? "C:\\Users\\test" : "/home/test";
  assert.equal(
    appConfigRoot("darwin", {}, home),
    join(home, "Library", "Application Support", "Contextual Language Learning"),
  );
  assert.equal(
    appConfigRoot("win32", {}, home),
    join(home, "AppData", "Roaming", "Contextual Language Learning"),
  );
  assert.equal(
    appConfigRoot("linux", {}, home),
    join(home, ".config", "contextual-language-learning"),
  );
  const custom = process.platform === "win32" ? "C:\\Data" : "/var/tmp/user";
  assert.equal(
    appConfigRoot("linux", { XDG_CONFIG_HOME: custom }, home),
    join(custom, "contextual-language-learning"),
  );
  assert.equal(
    defaultDocumentsFolder(home),
    join(home, "Documents", "Contextual Language Learning"),
  );
  assert.throws(() => appConfigRoot("freebsd", {}, home), /Unsupported/);
});
