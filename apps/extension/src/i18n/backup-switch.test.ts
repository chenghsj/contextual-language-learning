import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const oauth = await readFile(new URL("../../../local-host/src/drive/oauth.ts", import.meta.url), "utf8");
const callbackPage = await readFile(new URL("../../../local-host/src/drive/oauth-callback-page.ts", import.meta.url), "utf8");

test("backup uses the standard shadcn Switch without Button hover overrides", async () => {
  assert.match(app, /<Switch checked=\{backup.enabled\}/);
  assert.match(app, /onCheckedChange=\{enabled => enabled \? void enableBackup\(\)/);
  const source = await readFile(new URL("../components/ui/switch.tsx", import.meta.url), "utf8");
  assert.match(source, /SwitchPrimitives.Root/);
  assert.match(source, /SwitchPrimitives.Thumb/);
  assert.doesNotMatch(source, /hover:bg-primary/);
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
