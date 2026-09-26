import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("first run has no built-in selected Agent; persisted legacy users remain supported", async () => {
  const source = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(source, /const DEFAULT_AGENT: AgentSettings = \{ provider: "", modelId: "" \}/);
  assert.match(source, /if \(saved\.agent\) setAgent\(saved\.agent as AgentSettings\)/);
  assert.doesNotMatch(source, /options=\{agentCatalog\.map\(entry =>/);
  assert.match(source, /!agent\.provider \|\| installed\?\.\[agent\.provider\] !== true/);
  assert.match(source, /if \(created && !agent\.provider\) selectAgent\(provider\)/);
});
