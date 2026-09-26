import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const oauth = await readFile(new URL("../../../local-host/src/drive/oauth.ts", import.meta.url), "utf8");
const callbackPage = await readFile(new URL("../../../local-host/src/drive/oauth-callback-page.ts", import.meta.url), "utf8");

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
  assert.match(callbackPage, /已收到 Google 授權回應，正在驗證帳號/);
  assert.doesNotMatch(callbackPage, /已完成 Google Drive 授權/);
  assert.match(oauth, /session.finish\("success"\)/);
  assert.match(oauth, /session.finish\("error"\)/);
  assert.match(app, /driveConnectError && <p className="jobRowError" role="status">/);
});

test("saved Google identity is revalidated against the real Drive API before backup is presented as active", () => {
  assert.match(app, /const \[driveAccess, setDriveAccess\]/);
  assert.match(app, /type: "driveValidate", accountId \}\.then\(response =>/);
  assert.match(app, /setDriveAccess\(\{ accountId, status: "verified" \}\)/);
  assert.match(app, /setBackup\(current => current\.accountId === accountId && current\.enabled/);
  assert.match(app, /backup\.enabled && !driveAccessVerified/);
  assert.match(app, /backup\.enabled && driveAccessVerified/);
  assert.match(app, /t\("retryDriveAccess"\)/);
  assert.match(app, /driveConnectError && <p className="jobRowError" role="status">/);
});
