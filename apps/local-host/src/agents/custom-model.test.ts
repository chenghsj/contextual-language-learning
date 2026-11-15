import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, type CredentialStore } from "@earendil-works/pi-ai";
import { AgentSettingsSchema } from "@contextual/core";
import { generatePiText, piModels, resolvePiModel } from "./pi";
import { createTestPiRuntime } from "./credentials-test-support";
import { selectedPiModel } from "./custom-model";

test("explicit custom IDs reach the authenticated provider without changing its catalog or switching models", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-custom-model-"));
  try {
    const credentials: CredentialStore = {
      read: async id => (id === "openai" ? { type: "api_key", key: "synthetic" } : undefined),
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
    const fake = fauxProvider({ provider: "openai", models: [{ id: "known", reasoning: true }] });
    fake.setResponses([
      fauxAssistantMessage("Custom response"),
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "HTTP 403 model_access_denied",
      }),
    ]);
    const requested: string[] = [];
    runtime.registerNativeProvider({
      ...fake.provider,
      streamSimple(model, context, options) {
        requested.push(model.id);
        return fake.provider.streamSimple(model, context, options);
      },
    });
    const settings = AgentSettingsSchema.parse({
      provider: "openai",
      modelId: "vendor/future-model:latest",
      customModel: true,
    });
    await assert.rejects(
      resolvePiModel({ provider: "openai", modelId: settings.modelId }, runtime),
      /selected model is unavailable/,
    );
    const resolved = await resolvePiModel(settings, runtime);
    assert.equal(resolved.agent.customModel, true);
    assert.equal(resolved.model.id, settings.modelId);
    assert.equal(
      resolved.model.reasoning,
      false,
      "unknown models do not inherit reasoning capabilities",
    );
    assert.equal(
      resolved.model.cost.input,
      0,
      "unknown pricing must not be estimated from another model",
    );
    assert.ok(resolved.maxOutputTokens <= 8192);
    assert.ok(
      (await piModels(settings, runtime)).models.some(model => model.id === settings.modelId),
    );
    const result = await generatePiText(settings, "Use my model", new AbortController().signal, {
      root,
      runtime,
      format: "markdown",
    });
    assert.equal(result.text, "Custom response");
    assert.equal(result.call.modelId, settings.modelId);
    await assert.rejects(
      generatePiText(settings, "Rejected by provider", new AbortController().signal, {
        root,
        runtime,
        format: "markdown",
      }),
      /model_access_denied/,
    );
    assert.deepEqual(requested, [settings.modelId, settings.modelId]);
    assert.deepEqual(
      runtime.getModels("openai").map(model => model.id),
      ["known"],
    );
    await assert.rejects(
      resolvePiModel(
        { provider: "anthropic", modelId: "not-authorized", customModel: true },
        runtime,
      ),
      /Connect this AI provider/,
    );
    assert.equal(
      (await resolvePiModel({ provider: "openai", modelId: "known", customModel: true }, runtime))
        .model.reasoning,
      true,
      "catalog capabilities take precedence when the model becomes known",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manual IDs are validated at the request boundary and old selections remain compatible", () => {
  assert.deepEqual(AgentSettingsSchema.parse({ provider: "antigravity", modelId: "" }), {
    provider: "antigravity",
    modelId: "",
  });
  for (const modelId of ["", "Gemini 4 Hydrogen", "line\nbreak", " padded-id ", "a".repeat(121)]) {
    assert.equal(
      AgentSettingsSchema.safeParse({ provider: "antigravity", modelId, customModel: true })
        .success,
      false,
    );
  }
  assert.equal(
    AgentSettingsSchema.safeParse({
      provider: "antigravity",
      modelId: "gemini-4-hydrogen-high",
      customModel: true,
    }).success,
    true,
  );
});

test("new model IDs on multi-API services retain the matching family's transport", async () => {
  const templates = fauxProvider({
    models: [{ id: "gpt-known" }, { id: "claude-known" }],
  }).provider.getModels();
  const runtime = {
    checkAuth: async () => ({ type: "api_key" }),
    getModels: () => [
      { ...templates[0], api: "openai-completions" },
      { ...templates[1], api: "anthropic-messages" },
    ],
  } as unknown as ModelRuntime;
  const model = await selectedPiModel(
    { provider: "opencode", modelId: "claude-new-release", customModel: true },
    [],
    runtime,
  );
  assert.equal(model?.api, "anthropic-messages");
  assert.equal(model?.id, "claude-new-release");
  assert.equal(model?.reasoning, false);
  assert.equal(model?.cost.input, 0);
});

test("an unlisted Antigravity ID reaches the real plugin stream through normal authentication", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-custom-antigravity-"));
  const original = globalThis.fetch;
  const modelId = "gemini-future-manual-high";
  let posts = 0;
  try {
    await writeFile(
      join(root, "auth.json"),
      JSON.stringify({
        antigravity: {
          type: "oauth",
          access: "synthetic",
          refresh: "synthetic",
          expires: Date.now() + 3600000,
          projectId: "synthetic-project",
        },
      }),
      { mode: 0o600 },
    );
    globalThis.fetch = async (input, init) => {
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      if (String(input).includes("fetchAvailableModels"))
        return new Response(
          JSON.stringify({ models: { [modelId]: { displayName: "Future manual model" } } }),
          { headers: { "content-type": "application/json" } },
        );
      assert.ok(String(input).includes("streamGenerateContent"));
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, modelId);
      assert.deepEqual(body.request.tools ?? [], []);
      posts++;
      return new Response(
        `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "Custom Antigravity response" }] }, finishReason: "STOP" }] } })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const runtime = await createTestPiRuntime(root);
    assert.ok(!runtime.getModels("antigravity").some(model => model.id === modelId));
    const result = await generatePiText(
      { provider: "antigravity", modelId, customModel: true },
      "Use this exact ID",
      new AbortController().signal,
      { root, runtime, format: "markdown" },
    );
    assert.equal(result.text, "Custom Antigravity response");
    assert.equal(result.call.modelId, modelId);
    assert.equal(posts, 1);
  } finally {
    globalThis.fetch = original;
    await rm(root, { recursive: true, force: true });
  }
});
