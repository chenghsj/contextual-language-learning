import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test from "node:test";

const app = await readSource(new URL("../App.tsx", import.meta.url));
const backupUi = await readSource(
  new URL("../components/drive-backup-settings.tsx", import.meta.url),
);
const oauth = await readSource(new URL("../../../local-host/src/drive/oauth.ts", import.meta.url));
const callbackPage = await readSource(
  new URL("../../../local-host/src/drive/oauth-callback-page.ts", import.meta.url),
);

test("backup uses the standard shadcn Switch without Button hover overrides", async () => {
  assert.match(backupUi, /<Switch checked=\{backup.enabled\}/);
  assert.match(backupUi, /onCheckedChange=\{onEnabled\}/);
  assert.match(app, /onEnabled=\{enabled => enabled \? void enableBackup\(\)/);
  const source = await readSource(new URL("../components/ui/switch.tsx", import.meta.url));
  assert.match(source, /SwitchPrimitives.Root/);
  assert.match(source, /SwitchPrimitives.Thumb/);
  assert.doesNotMatch(source, /hover:bg-primary/);
});

test("Google callback does not claim connection succeeded before token storage finishes", () => {
  assert.match(callbackPage, /已收到 Google 授權回應，正在驗證帳號/);
  assert.doesNotMatch(callbackPage, /已完成 Google Drive 授權/);
  assert.match(oauth, /session.finish\("success"\)/);
  assert.match(oauth, /session.finish\("error"\)/);
  assert.match(app, /error=\{driveConnectError\}/);
  assert.match(
    backupUi,
    /role="status" className="[^"]+">\s*\{authExpired \? notice.authDescription : error\}/,
  );
});

test("saved Google identity is revalidated against the real Drive API before backup is presented as active", () => {
  assert.match(app, /const \[driveAccess, setDriveAccess\]/);
  assert.match(app, /type: "driveValidate", accountId \}\)\.then\(response =>/);
  assert.match(app, /setDriveAccess\(\{ accountId, status: "verified" \}\)/);
  assert.match(app, /setBackup\(current => current\.accountId === accountId && current\.enabled/);
  assert.match(app, /verified=\{driveAccessVerified\}/);
  assert.match(backupUi, /disabled=\{busy \|\| working \|\| !verified\}/);
  assert.match(backupUi, /t\("retryDriveAccess"\)/);
  assert.match(app, /error=\{driveConnectError\}/);
  assert.match(
    backupUi,
    /role="status" className="[^"]+">\s*\{authExpired \? notice.authDescription : error\}/,
  );
});
