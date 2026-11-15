import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { createPiRuntime, generatePi, piModels, piProviders, resolvePiModel } from "./pi";
import {
  localModelState,
  localModelSnapshot,
  saveLocalModelConfig,
  removeLocalModelConfig,
  testLocalModelConfig,
} from "./local-model";

const config = {
  baseUrl: "http://localhost:11434/v1",
  modelId: "local-fixture",
  contextWindow: 32768,
  maxTokens: 8192,
  reasoning: false,
};
function memoryCredentials() {
  const data = new Map<string, Credential>();
  const store: CredentialStore = {
    read: async id => data.get(id),
    list: async () => [...data].map(([providerId, value]) => ({ providerId, type: value.type })),
    modify: async (id, fn) => {
      const value = await fn(data.get(id));
      if (value) data.set(id, value);
      return value;
    },
    delete: async id => {
      data.delete(id);
    },
  };
  return store;
}
test("local config persists without keys; omitted keys stay scoped to their endpoint and can be removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-local-config-"));
  const store = memoryCredentials();
  try {
    assert.deepEqual(await localModelState(root, store), { config: null, hasApiKey: false });
    await saveLocalModelConfig({ config, apiKey: "$literal-secret" }, root, store);
    assert.doesNotMatch(await readFile(join(root, "local-model.json"), "utf8"), /secret|apiKey/);
    await saveLocalModelConfig({ config: { ...config, modelId: "another-model" } }, root, store);
    assert.deepEqual(await store.read("local"), { type: "api_key", key: "$literal-secret" });
    const sent: (string | null)[] = [];
    const fetcher: typeof fetch = async (_url, options) => {
      sent.push(new Headers(options?.headers).get("Authorization"));
      assert.equal(options?.redirect, "error");
      return Response.json({ data: [{ id: "one" }, { id: "one" }, {}, { id: "two" }] });
    };
    assert.deepEqual(await testLocalModelConfig({ config }, root, store, fetcher), {
      modelIds: ["one", "two"],
    });
    await testLocalModelConfig(
      { config: { ...config, baseUrl: "http://other-server/v1" } },
      root,
      store,
      fetcher,
    );
    assert.deepEqual(sent, ["Bearer $literal-secret", null]);
    await saveLocalModelConfig(
      { config: { ...config, baseUrl: "http://other-server/v1" } },
      root,
      store,
    );
    assert.equal(await store.read("local"), undefined);
    await saveLocalModelConfig({ config, apiKey: "new-secret" }, root, store);
    await saveLocalModelConfig({ config, apiKey: "" }, root, store);
    assert.equal((await localModelState(root, store)).hasApiKey, false);
    await removeLocalModelConfig(root, store);
    assert.deepEqual(await localModelState(root, store), { config: null, hasApiKey: false });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("connection failures do not persist configuration or expose server payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-local-errors-"));
  const store = memoryCredentials();
  try {
    for (const response of [
      new Response("secret-body", { status: 401 }),
      Response.json({ unexpected: "secret-body" }),
    ])
      await assert.rejects(
        testLocalModelConfig({ config }, root, store, async () => response),
        error => {
          assert.doesNotMatch(String(error), /secret-body/);
          return true;
        },
      );
    await assert.rejects(
      testLocalModelConfig({ config }, root, store, async () => {
        throw new Error("secret-body");
      }),
      /connection failed/,
    );
    assert.equal((await localModelState(root, store)).config, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("runtime snapshots wait for pending edits so new keys cannot reach the previous endpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-local-concurrent-"));
  const store = memoryCredentials();
  try {
    await saveLocalModelConfig({ config, apiKey: "first-key" }, root, store);
    let release!: () => void;
    let modified!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const entered = new Promise<void>(resolve => {
      modified = resolve;
    });
    const editing: CredentialStore = {
      ...store,
      modify: async (id, fn) => {
        const result = await store.modify(id, fn);
        modified();
        await gate;
        return result;
      },
    };
    const nextConfig = { ...config, baseUrl: "http://new-endpoint/v1" };
    const saving = saveLocalModelConfig({ config: nextConfig, apiKey: "next-key" }, root, editing);
    await entered;
    const snapshot = localModelSnapshot(root, store);
    release();
    await saving;
    assert.deepEqual(await snapshot, { config: nextConfig, apiKey: "next-key" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("persisted local models generate through the real Pi OpenAI-compatible streaming adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-local-inference-"));
  const store = memoryCredentials();
  const requests: { url: string; key: string | undefined; body: any }[] = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    requests.push({
      url: request.url!,
      key: request.headers.authorization,
      body: raw ? JSON.parse(raw) : null,
    });
    if (request.url?.endsWith("/models")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: [{ id: config.modelId }] }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: "local-test", object: "chat.completion.chunk", model: config.modelId, choices: [{ index: 0, delta: { role: "assistant", content: '{"local":true}' }, finish_reason: null }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ id: "local-test", object: "chat.completion.chunk", model: config.modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 } })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as { port: number };
    const first = { ...config, baseUrl: `http://127.0.0.1:${address.port}/first/v1` };
    await saveLocalModelConfig({ config: first, apiKey: "$first-literal-key" }, root, store);
    const runtime = await createPiRuntime(root, store);
    assert.equal(
      (await piProviders(runtime)).find(provider => provider.id === "local")?.connected,
      true,
    );
    assert.deepEqual(
      (await piModels({ provider: "local", modelId: "" }, runtime)).models.map(model => model.id),
      [config.modelId],
    );
    const resolved = await resolvePiModel({ provider: "local", modelId: config.modelId }, runtime);
    assert.equal(resolved.maxOutputTokens, config.maxTokens);
    assert.equal(resolved.contextWindow, config.contextWindow);
    assert.equal(resolved.agent.thinkingLevel, "off");
    await saveLocalModelConfig(
      {
        config: { ...first, baseUrl: first.baseUrl.replace("first", "second") },
        apiKey: "second-key",
      },
      root,
      store,
    );
    assert.deepEqual(
      await generatePi(
        { provider: "local", modelId: config.modelId },
        "Return local JSON",
        new AbortController().signal,
        { runtime, root },
      ),
      { local: true },
    );
    assert.equal(
      requests.at(-1)?.key,
      "Bearer $first-literal-key",
      "an in-flight runtime keeps its endpoint's original key",
    );
    assert.equal(requests.at(-1)?.url, "/first/v1/chat/completions");
    assert.equal(requests.at(-1)?.body.model, config.modelId);
    assert.equal(requests.at(-1)?.body.tools, undefined);
    assert.equal(requests.at(-1)?.body.reasoning_effort, undefined);
    assert.ok(requests.at(-1)?.body.max_tokens <= config.maxTokens);
    const next = await createPiRuntime(root, store);
    assert.deepEqual(
      await generatePi(
        { provider: "local", modelId: config.modelId },
        "Return local JSON",
        new AbortController().signal,
        { runtime: next, root },
      ),
      { local: true },
    );
    assert.equal(requests.at(-1)?.key, "Bearer second-key");
    await removeLocalModelConfig(root, store);
    const removed = await createPiRuntime(root, store);
    assert.equal(
      (await piProviders(removed)).find(provider => provider.id === "local")?.connected,
      false,
    );
    assert.deepEqual((await piModels({ provider: "local", modelId: "" }, removed)).models, []);
    await writeFile(join(root, "local-model.json"), "invalid");
    assert.ok(
      (await createPiRuntime(root, store)).getProvider("openai"),
      "corrupt local settings do not break cloud providers",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
