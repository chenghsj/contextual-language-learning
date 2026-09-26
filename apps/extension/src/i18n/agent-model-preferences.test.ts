import assert from "node:assert/strict";
import test from "node:test";
import { agentModelPreferenceKey, savedAgentModel, migrateAgentModelPreferences } from "./agent-model-preferences";

test("model choice is scoped to Agent and its isolated CLI config directory", () => {
  const preferences = {
    [agentModelPreferenceKey("codex")]: "gpt-default",
    [agentModelPreferenceKey("codex", "/Users/me/.codex-work")]: "gpt-work",
    [agentModelPreferenceKey("claude")]: "sonnet",
  };
  assert.equal(savedAgentModel("codex", undefined, preferences), "gpt-default");
  assert.equal(savedAgentModel("codex", "/Users/me/.codex-work", preferences), "gpt-work");
  assert.equal(savedAgentModel("claude", undefined, preferences), "sonnet");
  assert.equal(savedAgentModel("codex", "/Users/me/.codex-other", preferences), "");
});

test("migrates old per-provider preferences without changing the selected Agent", () => {
  const legacy = { codex: { modelId: "gpt-old", accountConfigDir: "/Users/me/.codex-work" },
    claude: { modelId: "sonnet" } };
  const migrated = migrateAgentModelPreferences({
    provider: "codex", modelId: "gpt-current", accountConfigDir: "/Users/me/.codex-work",
  }, legacy);
  assert.equal(savedAgentModel("codex", "/Users/me/.codex-work", migrated), "gpt-current");
  assert.equal(savedAgentModel("claude", undefined, migrated), "sonnet");
});
