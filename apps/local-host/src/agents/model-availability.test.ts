import test from "node:test";
import assert from "node:assert/strict";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, type CredentialStore } from "@earendil-works/pi-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PI_PROVIDER_IDS, piProviderDefinition } from "@contextual/core";
import { generatePiText, piModels, resolvePiModel } from "./pi";

const models = fauxProvider({
  models: [{ id: "sdk-first", reasoning: true }, { id: "sdk-second" }, { id: "sdk-excluded" }],
}).provider.getModels();

function runtime(
  available: typeof models = models.slice(0, 2),
  refreshError?: Error,
  throws = false,
) {
  return {
    getAvailable: async () => available,
    getModels: () => {
      throw new Error("Do not restore models excluded by SDK filters");
    },
    refresh: async () => {
      if (throws) throw refreshError;
      return {
        errors: new Map([
          ["radius", refreshError],
          ["antigravity", refreshError],
        ]),
      };
    },
    isUsingSubscription: () => false,
  } as unknown as ModelRuntime;
}

test("all registered services use SDK candidates without an extra account catalog allowlist", async t => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Separate catalog queries must not gate SDK candidates");
  });
  for (const provider of PI_PROVIDER_IDS) {
    const instance = runtime();
    const listed = await piModels({ provider, modelId: "" }, instance);
    assert.deepEqual(
      listed.models.map(model => model.id),
      ["sdk-first", "sdk-second"],
      provider,
    );
    assert.ok(
      listed.models.every(model => !("disabled" in model)),
      provider,
    );
    assert.equal(listed.warning, undefined, provider);
    const selected = await resolvePiModel({ provider, modelId: "sdk-second" }, instance);
    assert.equal(selected.model.id, "sdk-second", provider);
    const automatic = await resolvePiModel({ provider, modelId: "" }, instance);
    assert.equal(automatic.model.id, "sdk-first", provider);
  }
});

test("Copilot keeps all six SDK-filtered candidates selectable regardless of locally installed CLI", async () => {
  const ids = [
    "claude-haiku-4.5",
    "kimi-k3",
    "gpt-5-mini",
    "gpt-5.6-luna",
    "gpt-6-luna",
    "mai-code-1.1-flash",
  ];
  const providerModels = fauxProvider({ models: ids.map(id => ({ id })) }).provider.getModels();
  const instance = runtime(providerModels);
  const listed = await piModels({ provider: "github-copilot", modelId: "gpt-6-luna" }, instance);
  assert.deepEqual(
    listed.models.map(model => model.id),
    ids,
  );
  assert.ok(listed.models.every(model => !("disabled" in model)));
  assert.equal(
    (await resolvePiModel({ provider: "github-copilot", modelId: "gpt-6-luna" }, instance)).model
      .id,
    "gpt-6-luna",
  );
});

test("missing credentials, SDK-filtered models and invalid reasoning still prevent resolution", async () => {
  await assert.rejects(
    resolvePiModel({ provider: "openai", modelId: "" }, runtime([])),
    /selected model is unavailable/,
  );
  await assert.rejects(
    resolvePiModel({ provider: "openai", modelId: "sdk-excluded" }, runtime()),
    /selected model is unavailable/,
  );
  await assert.rejects(
    resolvePiModel({ provider: "openai", modelId: "sdk-second", thinkingLevel: "high" }, runtime()),
    /reasoning level is unavailable/,
  );
  const instance = runtime();
  instance.getAvailable = async () => {
    throw new Error("SDK authentication failed");
  };
  await assert.rejects(
    piModels({ provider: "openai", modelId: "" }, instance),
    /authentication failed/,
  );
});

test("successive account changes never reuse an application-owned model allowlist", async () => {
  const instance = runtime();
  const selected = { provider: "openai", modelId: "sdk-second" };
  await piModels(selected, instance);
  instance.getAvailable = async () => models.slice(0, 1);
  await assert.rejects(resolvePiModel(selected, instance), /selected model is unavailable/);
  const listed = await piModels({ ...selected, modelId: "" }, instance);
  assert.deepEqual(
    listed.models.map(model => model.id),
    ["sdk-first"],
  );
});

test("dynamic refresh failures warn only when the SDK still provides authenticated candidates", async () => {
  for (const provider of PI_PROVIDER_IDS.filter(
    id => piProviderDefinition(id)?.modelCatalog === "dynamic",
  )) {
    for (const throws of [false, true]) {
      const error = new Error("Synthetic catalog HTTP 503");
      const listed = await piModels({ provider, modelId: "" }, runtime(undefined, error, throws));
      assert.deepEqual(
        listed.models.map(model => model.id),
        ["sdk-first", "sdk-second"],
      );
      assert.match(listed.warning!, /HTTP 503/);
      if (provider === "antigravity")
        assert.ok(listed.models.every(model => model.availability === "unknown"));
      await assert.rejects(
        piModels({ provider, modelId: "" }, runtime([], error, throws)),
        /HTTP 503/,
      );
      const failedAuth = runtime(undefined, error, throws);
      failedAuth.getAvailable = async () => {
        throw new Error("SDK authentication failed");
      };
      await assert.rejects(
        piModels({ provider, modelId: "" }, failedAuth),
        /authentication failed/,
      );
    }
  }
});

test("dynamic model resolution refreshes the catalog before generation and rejects a retired saved selection", async () => {
  const instance = runtime();
  instance.refresh = async () => {
    instance.getAvailable = async () => models.slice(0, 1);
    return { errors: new Map(), aborted: false };
  };
  await assert.rejects(
    resolvePiModel({ provider: "antigravity", modelId: "sdk-second" }, instance),
    /selected model is unavailable/,
  );
  const listed = await piModels({ provider: "antigravity", modelId: "sdk-first" }, instance);
  assert.equal(listed.models[0].availability, "listed");
});

test("an SDK Copilot candidate reaches inference and provider denial never switches or permanently disables models", async t => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No extra catalog request");
  });
  const root = await mkdtemp(join(tmpdir(), "contextual-model-denial-"));
  try {
    const credentials: CredentialStore = {
      read: async id =>
        id === "github-copilot" ? { type: "api_key", key: "synthetic-provider-key" } : undefined,
      list: async () => [{ providerId: "github-copilot", type: "api_key" }],
      modify: async (_id, fn) => fn(undefined),
      delete: async () => {},
    };
    const instance = await ModelRuntime.create({
      credentials,
      modelsPath: null,
      modelsStorePath: join(root, "models.json"),
      refreshOnCreate: false,
    });
    const fake = fauxProvider({
      provider: "github-copilot",
      models: [{ id: "gpt-6-luna" }, { id: "claude-haiku-4.5" }],
    });
    fake.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "HTTP 403 model_access_denied: Account policy rejected this model",
      }),
      fauxAssistantMessage("Recovered response"),
    ]);
    const requested: string[] = [];
    instance.registerNativeProvider({
      ...fake.provider,
      streamSimple(model, context, options) {
        requested.push(model.id);
        return fake.provider.streamSimple(model, context, options);
      },
    });
    const settings = { provider: "github-copilot", modelId: "gpt-6-luna" };
    const options = { root, runtime: instance, format: "markdown" as const };
    await assert.rejects(
      generatePiText(settings, "Requested model", new AbortController().signal, options),
      /model_access_denied/,
    );
    assert.deepEqual(requested, [settings.modelId], "no fallback model or repeated denied request");
    const listed = await piModels(settings, instance);
    assert.equal(listed.models.find(model => model.id === settings.modelId)?.id, settings.modelId);
    assert.ok(listed.models.every(model => !("disabled" in model)));
    const recovery = await generatePiText(
      settings,
      "User retries",
      new AbortController().signal,
      options,
    );
    assert.equal(recovery.text, "Recovered response");
    assert.deepEqual(requested, [settings.modelId, settings.modelId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
