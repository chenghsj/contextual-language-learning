import assert from "node:assert/strict";
import test from "node:test";
import { assertImportedAgentProvider, generateWithAgent, getAgentCatalog } from "./agents";

test("the Host catalog contains only user-imported Agent definitions", async () => {
  const agents = await getAgentCatalog();
  assert.ok(agents.every(entry =>
    /^custom-[a-f0-9]{24}$/.test(entry.id) && entry.custom === true &&
      typeof entry.label === "string" && typeof entry.installed === "boolean"));
});

test("removed built-in providers cannot execute or be selected", async () => {
  for (const provider of ["claude", "codex", "agy", "../../bin/sh", ""]) {
    assert.throws(() => assertImportedAgentProvider(provider), /no longer supported/);
    await assert.rejects(() => generateWithAgent({ provider, modelId: "" },
      "Hello", new AbortController().signal), /no longer supported/);
  }
  assert.doesNotThrow(() => assertImportedAgentProvider("custom-" + "a".repeat(24)));
});
