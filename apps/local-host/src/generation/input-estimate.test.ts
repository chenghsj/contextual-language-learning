import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, type CredentialStore, type Credential } from "@earendil-works/pi-ai";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  GenerationRequestSchema,
  CustomGenerationRequestSchema,
  chunkCues,
} from "@contextual/core";
import { estimateGenerationInput } from "./input-estimate";
import { lessonResources } from "../agents/pi";
import { billingKind } from "../agents/billing";
import { learningPointsPrompts } from "./learning-points-prompts";
const pointsCandidatePrompt = learningPointsPrompts().pointsCandidatePrompt;
import { SYSTEM } from "./learning-points-rules";

const request = (count = 1) =>
  GenerationRequestSchema.parse({
    outputSchemaVersion: 7,
    id: randomUUID(),
    source: { platform: "import", title: "Dialogue" },
    profile: {
      targetLanguage: "en",
      instructionLanguage: "zh-TW",
      level: "B1",
      sceneCount: 4,
      contextualExampleCount: 2,
    },
    agent: { provider: "openai", modelId: "priced" },
    backup: { enabled: false },
    cues: Array.from({ length: count }, (_, i) => ({
      id: `cue-${i}`,
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      originalText: "Dialogue. ".repeat(35),
    })),
  });

test("initial input includes each chunk's instructions and uses SDK pricing without inference", async () => {
  const root = await mkdtemp(join(tmpdir(), "input-estimate-"));
  try {
    const credentials: CredentialStore = {
      read: async () => ({ type: "api_key", key: "not-a-real-key" }) as Credential,
      list: async () => [{ providerId: "openai", type: "api_key" }],
      modify: async (_id, fn) => fn(undefined),
      delete: async () => {},
    };
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      modelsStorePath: join(root, "models.json"),
      refreshOnCreate: false,
    });
    const fake = fauxProvider({
      provider: "openai",
      models: [
        {
          id: "priced",
          cost: { input: 2, output: 8, cacheRead: 1, cacheWrite: 2 },
          contextWindow: 16384,
          maxTokens: 4096,
        },
        { id: "unpriced", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      ],
    });
    runtime.registerNativeProvider({ ...fake.provider, filterModels: models => models });
    const payload = request(100);
    const chunks = chunkCues(payload.cues);
    assert.ok(chunks.length > 1);
    const result = await estimateGenerationInput(payload, runtime);
    const expected = chunks.reduce(
      (sum, cues, index) =>
        sum +
        estimateTextTokens(SYSTEM) +
        estimateTextTokens(
          pointsCandidatePrompt(
            payload,
            cues.map(c => c.id),
            4096,
          ),
        ),
      0,
    );
    assert.equal(result.inputTokens, expected);
    const experimental = await estimateGenerationInput(payload, runtime, "compact-scenes-1");
    assert.ok(experimental.inputTokens < result.inputTokens);
    assert.equal(result.inputCalls, chunks.length);
    assert.ok(Math.abs(result.inputCostUsd! - (expected * 2) / 1_000_000) < 1e-12);
    assert.equal(result.billing, "api");
    assert.equal(result.modelId, "priced");
    assert.equal(
      (
        await estimateGenerationInput(
          { ...payload, agent: { provider: "openai", modelId: "unpriced" } },
          runtime,
        )
      ).inputCostUsd,
      undefined,
    );

    const custom = CustomGenerationRequestSchema.parse({
      ...payload,
      kind: "custom",
      prompt: "Explain this dialogue.",
      context: { subtitles: true, title: true },
    });
    const split = await estimateGenerationInput(custom, runtime);
    assert.ok(split.inputCalls > 1, "custom estimate follows the segment plan");
    const noContext = { ...custom, context: { subtitles: false, title: false } };
    const small = await estimateGenerationInput(noContext, runtime);
    const changed = await estimateGenerationInput(
      {
        ...noContext,
        source: { ...noContext.source, title: "Hidden title ".repeat(10) },
        cues: request(1).cues,
      },
      runtime,
    );
    assert.equal(small.inputCalls, 1);
    assert.equal(
      small.inputTokens,
      changed.inputTokens,
      "excluded context cannot affect the estimate",
    );
    assert.ok(small.inputTokens < split.inputTokens);
    assert.equal(
      fake.state.callCount,
      0,
      "estimating never generates content or incurs inference charges",
    );
    await assert.rejects(
      estimateGenerationInput(
        { ...payload, agent: { provider: "openai", modelId: "missing" } },
        runtime,
      ),
      /unavailable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("subscription auth is separate from API catalog prices", () => {
  for (const [provider, subscription, expected] of [
    ["openai", false, "api"],
    ["openai", true, "subscription"],
    ["anthropic", true, "subscription"],
    ["github-copilot", true, "subscription"],
    ["antigravity", false, "subscription"],
    ["openrouter", false, "api"],
    ["google", false, "api"],
  ] as const)
    assert.equal(billingKind(provider, subscription), expected);
});
