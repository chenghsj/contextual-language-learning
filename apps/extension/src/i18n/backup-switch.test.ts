import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const oauth = await readFile(new URL("../../../local-host/src/drive/oauth.ts", import.meta.url), "utf8");
const callbackPage = await readFile(new URL("../../../local-host/src/drive/oauth-callback-page.ts", import.meta.url), "utf8");

test("backup switch has a compact visual track inside an accessible 44×36 hit target", () => {
  const switchMarkup = app.slice(app.indexOf('role="switch"'));
  const hitTarget = switchMarkup.match(/className="([^"]+)"/)?.[1] ?? "";
  const track = switchMarkup.match(/<span aria-hidden="true" className="([^"]+)"/)?.[1] ?? "";
  const thumb = switchMarkup.match(/<span className="([^"]+)" \/>/)?.[1] ?? "";
  assert.ok(hitTarget.includes("h-9") && hitTarget.includes("w-11"));
  assert.ok(track.includes("h-[22px]") && track.includes("w-[38px]"));
  assert.ok(track.includes("group-aria-checked:bg-primary"));
  assert.ok(thumb.includes("size-4") && thumb.includes("group-aria-checked:translate-x-4"));
  assert.match(app, /role="switch" aria-checked=\{backup.enabled\}/);
});

test("Google callback does not claim connection succeeded before token storage finishes", () => {
  assert.match(callbackPage, /已收到 Google 授權回應，正在驗證帳號/);
  assert.doesNotMatch(callbackPage, /已完成 Google Drive 授權/);
  assert.match(oauth, /session.finish\("success"\)/);
  assert.match(oauth, /session.finish\("error"\)/);
  assert.match(app, /driveConnectError && <p className="[^"]+" role="status">/);
});

test("saved Google identity is revalidated against the real Drive API before backup is presented as active", () => {
  assert.match(app, /const \[driveAccess, setDriveAccess\]/);
  assert.match(app, /type: "driveValidate", accountId \}\)\.then\(response =>/);
  assert.match(app, /setDriveAccess\(\{ accountId, status: "verified" \}\)/);
  assert.match(app, /setBackup\(current => current\.accountId === accountId && current\.enabled/);
  assert.match(app, /backup\.enabled && !driveAccessVerified/);
  assert.match(app, /backup\.enabled && driveAccessVerified/);
  assert.match(app, /t\("retryDriveAccess"\)/);
  assert.match(app, /driveConnectError && <p className="[^"]+" role="status">/);
});
