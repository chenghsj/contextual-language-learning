import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const oauth = await readFile(new URL("../../../local-host/src/drive/oauth.ts", import.meta.url), "utf8");
const callbackPage = await readFile(new URL("../../../local-host/src/drive/oauth-callback-page.ts", import.meta.url), "utf8");

test("backup switch uses accessible Tailwind track and thumb states", () => {
  const switchMarkup = app.slice(app.indexOf('role="switch"'));
  const track = switchMarkup.match(/className="([^"]+)"/)?.[1] ?? "";
  const thumb = switchMarkup.match(/<span className="([^"]+)"/)?.[1] ?? "";
  assert.ok(track.includes("justify-start"));
  assert.ok(track.includes("w-[46px]"));
  assert.ok(track.includes("h-[27px]"));
  assert.ok(track.includes("p-[3px]"));
  assert.ok(track.includes("aria-checked:bg-primary"));
  assert.ok(thumb.includes("size-[21px]"));
  assert.ok(thumb.includes("translate-x-0"));
  assert.ok(thumb.includes("group-aria-checked:translate-x-[19px]"));
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
