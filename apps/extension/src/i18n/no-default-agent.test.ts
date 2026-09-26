import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { agentOnboardingCopy } from "./agent-onboarding";

test("new and upgrading users never receive a built-in default Agent/model", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(source, /const DEFAULT_AGENT: AgentSettings = \{ provider: "", modelId: "" \}/);
  assert.match(source, /if \(saved\.agent\) setAgent\(restoreImportedAgentSelection\(saved\.agent\)\)/);
  assert.match(source, /!isImportedAgentId\(current\.provider\)/);
  assert.doesNotMatch(source, /\{t\("defaultAgent"\)\}:/);
  assert.doesNotMatch(source, /\{t\("defaultModel"\)\}/);
  assert.match(source, /isImportedAgentId\(agent\.provider\) && <><label/);
  assert.match(source, /isImportedAgentId\(agent\.provider\) && <div/);
  assert.doesNotMatch(source, /options=\{agentCatalog\.map\(entry =>/);
  assert.match(source, /if \(created && !agent\.provider\) selectAgent\(provider\)/);
});

test("selected-Agent-only model label is localized without claiming a global default", () => {
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    assert.ok(agentOnboardingCopy[locale].modelLabel.trim(), locale);
  }
});
