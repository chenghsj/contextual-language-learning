import assert from "node:assert/strict";
import test from "node:test";
import { assertPiProvider, generateWithAgent, getAgentCatalog } from "./agents";
import { PI_PROVIDER_IDS } from "@immersive/core";
test("Host advertises SDK providers without CLI executable discovery", async () => {
  const agents = await getAgentCatalog();
  assert.deepEqual(
    agents.map(a => a.id),
    [...PI_PROVIDER_IDS],
  );
  assert.ok(
    agents.every(a => Object.keys(a).every(key => ["id", "label", "installed"].includes(key))),
  );
});
test("old CLI tasks cannot silently execute with different provider semantics", async () => {
  for (const provider of [
    "custom-" + "a".repeat(24),
    "claude",
    "codex",
    "agy",
    "../../bin/sh",
    "",
  ]) {
    assert.throws(() => assertPiProvider(provider), /old CLI/);
    await assert.rejects(
      generateWithAgent({ provider, modelId: "" }, "Hello", new AbortController().signal),
      /old CLI/,
    );
  }
  assert.doesNotThrow(() => assertPiProvider("openai"));
});
