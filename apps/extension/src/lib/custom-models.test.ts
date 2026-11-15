import assert from "node:assert/strict";
import test from "node:test";
import { PreferencesStore } from "./preferences-store";
import { selectedCustomModel, rememberCustomModelId } from "./custom-models";

test("custom IDs and selection persist separately for each provider and can be removed", async () => {
  let saved: Record<string, unknown> = {};
  const storage = {
    get: async () => saved,
    set: async (value: Record<string, unknown>) => {
      saved = value;
    },
  };
  const store = new PreferencesStore(storage);
  const defaults = await store.load();
  const agent = { provider: "antigravity", modelId: "future-model", customModel: true };
  await store.save({
    ...defaults,
    agent,
    providerSettings: { antigravity: { modelId: agent.modelId, customModel: true } },
    customModels: { antigravity: [agent.modelId], openai: ["different-model"] },
  });
  const loaded = await new PreferencesStore(storage).load();
  assert.deepEqual(loaded.agent, agent);
  assert.equal(loaded.providerSettings.antigravity.customModel, true);
  assert.deepEqual(loaded.customModels, {
    antigravity: [agent.modelId],
    openai: ["different-model"],
  });
  await store.save({
    ...loaded,
    agent: { provider: "antigravity", modelId: "" },
    customModels: { ...loaded.customModels, antigravity: [] },
  });
  assert.deepEqual((await new PreferencesStore(storage).load()).customModels, {
    antigravity: [],
    openai: ["different-model"],
  });
});

test("only explicit custom selections can survive a missing catalog entry", () => {
  const selected = { modelId: "new-model", customModel: true };
  assert.equal(selectedCustomModel(selected, [])?.id, "new-model");
  assert.equal(selectedCustomModel({ modelId: selected.modelId }, []), undefined);
  const known = { id: "new-model", label: "Official model", thinkingLevels: ["high" as const] };
  assert.equal(selectedCustomModel(selected, [known]), known);
});

test("a newly searched model still persists when saved model history is full", async () => {
  let saved: Record<string, unknown> = {};
  const storage = {
    get: async () => saved,
    set: async (value: Record<string, unknown>) => {
      saved = value;
    },
  };
  const store = new PreferencesStore(storage);
  const defaults = await store.load();
  const history = { openai: Array.from({ length: 50 }, (_, i) => `saved-${i}`) };
  const customModels = rememberCustomModelId(history, "openai", "newly-searched");
  assert.equal(customModels, history, "preserve existing saved IDs");
  await store.save({
    ...defaults,
    customModels,
    agent: { provider: "openai", modelId: "newly-searched", customModel: true },
  });
  const loaded = await new PreferencesStore(storage).load();
  assert.ok(loaded.agent);
  assert.equal(loaded.agent.modelId, "newly-searched");
  assert.equal(loaded.agent.customModel, true);
  assert.equal(loaded.customModels?.openai.length, 50);
});
