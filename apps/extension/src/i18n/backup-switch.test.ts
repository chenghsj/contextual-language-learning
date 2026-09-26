import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const oauth = await readFile(new URL("../../../local-host/src/drive/oauth.ts", import.meta.url), "utf8");

test("backup switch starts at the left and moves inside its track only when enabled", () => {
  const rule = css.match(/button\[data-slot="button"\]\.backupSwitch \{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /justify-content: flex-start;/);
  assert.match(rule, /width: 46px; height: 27px; padding: 3px;/);
  const thumb = css.match(/\.backupSwitchThumb \{([^}]+)\}/)?.[1] ?? "";
  assert.match(thumb, /width: 21px; height: 21px;/);
  assert.match(thumb, /transform: translateX\(0\)/);
  assert.match(css, /\.backupSwitch\[aria-checked="true"\] \.backupSwitchThumb \{ transform: translateX\(19px\); \}/);
  assert.match(css, /button\[data-slot="button"\]\.backupSwitch\[aria-checked="true"\] \{ background: var\(--primary\); \}/);
  assert.match(app, /role="switch" aria-checked=\{backup.enabled\}/);
});

test("Google callback does not claim connection succeeded before token storage finishes", () => {
  assert.match(oauth, /已收到 Google 授權回應，正在完成帳號連結/);
  assert.doesNotMatch(oauth, /已完成 Google Drive 授權/);
  assert.match(app, /driveConnectError && <p className="jobRowError" role="status">/);
});
