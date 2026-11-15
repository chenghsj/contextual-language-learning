import test from "node:test";
import assert from "node:assert/strict";
import { fauxProvider, type Model, type Api } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolvePiModel } from "./pi";
import { initialLearningPointsBudget } from "../generation/learning-points-prompts";

const available = fauxProvider({
  models: [
    { id: "gemini-3.8-flash", reasoning: true, contextWindow: 1048576, maxTokens: 65536 },
    { id: "plain", reasoning: false },
  ],
}).provider.getModels();
const runtimeFor = (models: readonly Model<Api>[]) =>
  ({
    getAvailable: async () => models,
    isUsingSubscription: () => false,
  }) as unknown as ModelRuntime;

test("automatic reasoning is resolved before the output allowance, exactly like explicit medium", async () => {
  const runtime = runtimeFor(available);
  const automatic = await resolvePiModel({ provider: "openai", modelId: available[0].id }, runtime);
  const explicit = await resolvePiModel(
    { provider: "openai", modelId: available[0].id, thinkingLevel: "medium" },
    runtime,
  );
  assert.equal(automatic.agent.thinkingLevel, "medium");
  assert.deepEqual(automatic.agent, explicit.agent);
  assert.equal(initialLearningPointsBudget(automatic, automatic.agent.thinkingLevel).output, 32768);
});

test("automatic reasoning respects model capabilities; explicit choices are not silently clamped", async () => {
  const runtime = runtimeFor(available);
  assert.equal(
    (await resolvePiModel({ provider: "openai", modelId: "plain" }, runtime)).agent.thinkingLevel,
    "off",
  );
  assert.equal(
    (
      await resolvePiModel(
        { provider: "openai", modelId: available[0].id, thinkingLevel: "low" },
        runtime,
      )
    ).agent.thinkingLevel,
    "low",
  );
  await assert.rejects(
    resolvePiModel({ provider: "openai", modelId: "plain", thinkingLevel: "medium" }, runtime),
    /reasoning level is unavailable/,
  );
  const restricted = {
    ...available[0],
    thinkingLevelMap: { medium: null, high: "high" },
  } as Model<Api>;
  assert.equal(
    (await resolvePiModel({ provider: "openai", modelId: restricted.id }, runtimeFor([restricted])))
      .agent.thinkingLevel,
    "high",
  );
});
