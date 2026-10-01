import assert from "node:assert/strict";
import test from "node:test";
import { savedAgentModel, agentModelPreferenceKey } from "./agent-model-preferences";
test("model preferences use only supported provider keys", () => {
  assert.equal(agentModelPreferenceKey("openai"), "openai");
  assert.equal(savedAgentModel("openai", { openai: "gpt", anthropic: "claude" }), "gpt");
  assert.equal(savedAgentModel("codex", { codex: "old" }), "");
  assert.equal(savedAgentModel("google", {}, "default"), "default");
});
