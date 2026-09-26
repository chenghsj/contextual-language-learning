import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { agentOnboardingCopy } from "./agent-onboarding";

test("BYO Agent onboarding copy is complete in five locales", () => {
  const keys = Object.keys(agentOnboardingCopy.en).sort();
  for (const locale of ["zh-TW", "zh-CN", "ja", "ko"] as const) {
    assert.deepEqual(Object.keys(agentOnboardingCopy[locale]).sort(), keys);
    for (const key of keys) {
      assert.ok((agentOnboardingCopy[locale] as Record<string, string>)[key]?.length);
    }
    assert.ok(agentOnboardingCopy[locale].testing.trim());
  }
});
test("BYO UI uses real Host import/edit/probe/test/remove actions", async () => {
  const source = await readFile(new URL("../components/custom-agent-settings.tsx", import.meta.url), "utf8");
  for (const name of ["customAgentImport", "customAgentSave", "customAgentTest",
    "customAgentProbe", "customAgentRemove"]) assert.ok(source.includes(name), name);
  assert.match(source, /parseAgentImport\(json\)/);
  assert.match(source, /window\.confirm\(ui\.testWarning\)/);
  assert.match(source, /testSavedAgent\(agent\)/);
  assert.match(source, /setTesting\("draft"\)/);
  assert.match(source, /setTesting\(agent\.id\)/);
  assert.match(source, /finally \{ setTesting\(null\); setBusy\(false\); \}/);
  assert.match(source, /aria-busy=\{testing === agent\.id\}/);
  assert.match(source, /aria-busy=\{testing === "draft"\}/);
  assert.match(source, /testing === agent\.id \? ui\.testing : ui\.test/);
  assert.match(source, /testing === "draft" \? ui\.testing : ui\.test/);
  assert.match(source, /motion-reduce:animate-none/);
  assert.match(source, /aria-live="polite"/);
});
