import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { messages, type UiLocale } from "./messages";
import { hostConnectionCopy } from "./host-connection";

test("Native Host version mismatch is actionable without presenting install before first check", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  const component = await readSource(
    new URL("../components/host-connection-settings.tsx", import.meta.url),
  );
  assert.match(app, /checked=\{hostChecked\}/);
  assert.match(app, /setHostSdkMode\(message\.agentMode === "pi-sdk"\)/);
  assert.match(app, /available=\{hostReady\}/);
  assert.match(component, /version === chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(component, /checked && \(!connected \|\| !compatible\)/);
  assert.match(component, /!sdkMode && <p/);
  assert.match(component, /VITE_HOST_SETUP_DOWNLOAD_URL/);
  assert.match(component, /protocolVersion === HOST_PROTOCOL_VERSION/);
  assert.match(component, /ui.protocolMismatch/);
  assert.doesNotMatch(component, /pnpm build|scripts\/install-host|SelectField/);
  const keys = Object.keys(hostConnectionCopy.en).sort();
  for (const locale of Object.keys(messages) as UiLocale[]) {
    assert.deepEqual(Object.keys(hostConnectionCopy[locale]).sort(), keys);
    for (const key of keys)
      assert.ok((hostConnectionCopy[locale] as Record<string, string>)[key]?.trim());
    for (const key of [
      "hostVersionMismatch",
      "hostVersionUnknown",
      "hostUpdateDownload",
    ] as const) {
      assert.ok(messages[locale][key].trim());
    }
  }
});
