import assert from "node:assert/strict";
import test from "node:test";
import { getAgentAdapter, getAgentCatalog } from "./agents";

test("provider IDs resolve through the trusted registry", () => {
  assert.equal(getAgentAdapter("claude").label, "Claude Code");
  assert.equal(getAgentAdapter("codex").supportsAccountProfiles, true);
  assert.equal(getAgentAdapter("agy").supportsAccountProfiles, false);
  assert.throws(() => getAgentAdapter("../../bin/sh"), /Unsupported Agent/);
});

test("catalog presents providers with explicit capabilities and installation status", async () => {
  const entries = await getAgentCatalog();
  assert.ok(entries.some(entry => entry.id === "claude"));
  assert.ok(entries.every(entry => typeof entry.installed === "boolean" && typeof entry.label === "string"));
});
