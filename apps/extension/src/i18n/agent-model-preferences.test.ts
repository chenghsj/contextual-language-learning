import assert from "node:assert/strict";
import test from "node:test";
import { agentModelPreferenceKey, savedAgentModel, migrateAgentModelPreferences,
  filterImportedModelPreferences } from "./agent-model-preferences";

const first = "openai";
const second = "anthropic";

test("models are scoped to an imported Agent and its CLI account directory", () => {
  const saved = {
    [agentModelPreferenceKey(first)]: "default",
    [agentModelPreferenceKey(first, "/Users/me/.work")]: "work",
    [agentModelPreferenceKey(second)]: "another",
  };
  assert.equal(savedAgentModel(first, undefined, saved), "default");
  assert.equal(savedAgentModel(first, "/Users/me/.work", saved), "work");
  assert.equal(savedAgentModel(first, "/Users/me/.other", saved), "");
  assert.equal(savedAgentModel(second, undefined, saved), "another");
});

test("migration drops obsolete built-in model settings without touching imported Agent preferences", () => {
  const previous = {
    [agentModelPreferenceKey("codex")]: "old",
    [agentModelPreferenceKey(first, "/Users/me/.work")]: "new",
    "bad": "ignored",
  };
  assert.deepEqual(filterImportedModelPreferences(previous),
    { [agentModelPreferenceKey(first, "/Users/me/.work")]: "new" });
  assert.equal(savedAgentModel("codex", undefined, previous), "");
  const migrated = migrateAgentModelPreferences({ provider: "agy", modelId: "legacy" }, {
    codex: { modelId: "legacy" }, [first]: { modelId: "imported", accountConfigDir: "/Users/me/.work" },
  });
  assert.deepEqual(migrated, { [agentModelPreferenceKey(first, "/Users/me/.work")]: "imported" });
});
