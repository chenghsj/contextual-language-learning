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
    assert.ok(agentOnboardingCopy[locale].copying.trim());
    assert.ok(agentOnboardingCopy[locale].copyFailed.trim());
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

test("prompt copy shows inline success/error and a timed Lucide icon change", async () => {
  const source = await readFile(new URL("../components/custom-agent-settings.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ Check, Copy \} from "lucide-react"/);
  assert.match(source, /await navigator\.clipboard\.writeText\(AGENT_CONFIG_PROMPT\)/);
  assert.match(source, /setCopyFeedback\("copied"\)/);
  assert.match(source, /copyFeedback === "copied" \? <Check aria-hidden="true" \/> : <Copy aria-hidden="true" \/>/);
  assert.match(source, /copyFeedback === "copied" \? ui\.copied/);
  assert.match(source, /window\.setTimeout\(\(\) => \{/);
  assert.match(source, /\}, 2_000\)/);
  assert.match(source, /window\.clearTimeout\(copyResetRef\.current\)/);
  assert.match(source, /setCopyFeedback\("failed"\)/);
  assert.match(source, /role="alert">\{ui\.copyFailed\}/);
  assert.match(source, /role="status" aria-live="polite">\{ui\.copied\}/);
  assert.doesNotMatch(source, /setStatus\(ui\.copied\)/,
    "copy feedback must be adjacent to the button rather than at the bottom of settings");
});

test("existing Agent edits do not appear inside new Agent onboarding", async () => {
  const source = await readFile(new URL("../components/custom-agent-settings.tsx", import.meta.url), "utf8");
  assert.match(source, /editing && <section ref=\{editPanelRef\}/);
  assert.match(source, /data-ui="editAgentPanel"/);
  assert.match(source, /!editing && <details className="min-w-0 border border-border p-3"/);
  assert.match(source, /\{renderJsonEditor\(\)\}/);
  assert.match(source, /editing \? ui\.edit : ui\.import/);
  assert.match(source, /editing \? "edit-agent-json" : "import-agent-json"/);
  assert.match(source, /if \(editing\) editPanelRef\.current\?\.scrollIntoView/);
  assert.match(source, /type: "customAgentSave"/);
  assert.match(source, /type: "customAgentImport"/);
});
