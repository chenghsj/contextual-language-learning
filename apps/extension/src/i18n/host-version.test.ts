import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { messages, type UiLocale } from "./messages";

test("older Native Hosts get an update prompt instead of silently appearing compatible", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /setHostVersion\(typeof message.version === "string" \? message.version : null\)/);
  assert.match(app, /hostVersion !== chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(app, /immersive-language-learning\/releases/);
  for (const locale of Object.keys(messages) as UiLocale[]) {
    for (const key of ["hostVersionMismatch", "hostVersionUnknown", "hostUpdateDownload"] as const) {
      assert.ok(messages[locale][key].trim(), locale + " " + key);
    }
  }
});
