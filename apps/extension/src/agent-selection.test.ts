import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_AGENT_SELECTION, isImportedAgentId, restoreImportedAgentSelection } from "./agent-selection";

const imported = "custom-" + "a".repeat(24);

test("legacy built-in Agent and model selections are not displayed as BYO defaults", () => {
  for (const provider of ["agy", "claude", "codex"]) {
    assert.deepEqual(restoreImportedAgentSelection({
      provider, modelId: "previous-selected-model", accountConfigDir: "/home/user/.legacy",
    }), EMPTY_AGENT_SELECTION);
  }
  assert.deepEqual(restoreImportedAgentSelection(null), EMPTY_AGENT_SELECTION);
  assert.deepEqual(restoreImportedAgentSelection({ provider: "custom-invalid", modelId: "" }),
    EMPTY_AGENT_SELECTION);
});

test("valid imported Agent selection and its existing account environment persist", () => {
  assert.ok(isImportedAgentId(imported));
  assert.deepEqual(restoreImportedAgentSelection({
    provider: imported, modelId: "model-1", accountConfigDir: "/home/user/.codex-work",
  }), { provider: imported, modelId: "model-1", accountConfigDir: "/home/user/.codex-work" });
  assert.deepEqual(restoreImportedAgentSelection({ provider: imported, modelId: "" }),
    { provider: imported, modelId: "" });
});
