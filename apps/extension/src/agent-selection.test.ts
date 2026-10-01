import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_AGENT_SELECTION, restorePiAgentSelection } from "./agent-selection";
import { AgentSettingsSchema } from "@immersive/core";
test("empty and removed CLI selections are form states, never generation settings", () => {
  for (const provider of ["", "agy", "claude", "codex", "custom-" + "a".repeat(24)]) {
    assert.deepEqual(restorePiAgentSelection({ provider, modelId: "old" }), EMPTY_AGENT_SELECTION);
  }
  assert.equal(AgentSettingsSchema.safeParse(EMPTY_AGENT_SELECTION).success, false);
  assert.equal(
    AgentSettingsSchema.safeParse({ provider: "openai", modelId: "", accountConfigDir: "/tmp" })
      .success,
    false,
  );
  assert.deepEqual(
    restorePiAgentSelection({ provider: "openai", modelId: "gpt", thinkingLevel: "high" }),
    { provider: "openai", modelId: "gpt", thinkingLevel: "high" },
  );
});
