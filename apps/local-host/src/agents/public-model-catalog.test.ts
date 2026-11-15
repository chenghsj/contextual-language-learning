import test from "node:test";
import assert from "node:assert/strict";
import { createPublicModelCatalog } from "./public-model-catalog";
import { discoverPiModels } from "./pi";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const textModel = (id: string, name = id) => ({
  id,
  name,
  tool_call: true,
  modalities: { input: ["text"], output: ["text"] },
});
test("public lookup keeps service IDs, excludes retired and non-text models, and never sends credentials", async () => {
  let fetches = 0;
  const read = createPublicModelCatalog(async (url, init) => {
    assert.equal(url, "https://models.dev/api.json");
    assert.equal(init?.headers, undefined);
    fetches++;
    return new Response(
      JSON.stringify({
        openai: {
          models: {
            "gpt-future": {
              ...textModel("gpt-future", "GPT Future"),
              canonical_model_id: "openai/gpt-future",
            },
            retired: { ...textModel("retired"), status: "deprecated" },
            disabled: { ...textModel("disabled"), disabled: true },
            image: {
              id: "image",
              name: "Image",
              modalities: { input: ["text"], output: ["image"] },
            },
            mismatch: textModel("different-id"),
            embedding: { ...textModel("embedding"), tool_call: false },
            realtime: {
              ...textModel("realtime"),
              modalities: { input: ["text"], output: ["text", "audio"] },
            },
            "invalid id": textModel("invalid id"),
          },
        },
        anthropic: { models: { "claude-future": textModel("claude-future", "Claude Future") } },
        "alibaba-coding-plan-cn": { models: { "qwen-future": textModel("qwen-future") } },
      }),
    );
  });
  assert.deepEqual(await read("openai"), [{ id: "gpt-future", label: "GPT Future" }]);
  assert.deepEqual(await read("anthropic"), [{ id: "claude-future", label: "Claude Future" }]);
  assert.deepEqual(await read("qwen-token-plan-individual-cn"), [
    { id: "qwen-future", label: "qwen-future" },
  ]);
  assert.equal(fetches, 1, "one public snapshot is shared across services");
  for (const provider of ["openai-codex", "azure", "antigravity", "local", "radius", "unknown"])
    assert.deepEqual(await read(provider), []);
  assert.equal(fetches, 1, "account/deployment routes do not borrow public API catalogs");
  await read("openai", true);
  assert.equal(fetches, 2, "explicit refresh bypasses the snapshot cache");
});

test("directory requests coalesce and failed refreshes preserve the cached snapshot", async () => {
  let fetches = 0,
    fail = false;
  const read = createPublicModelCatalog(async () => {
    fetches++;
    await Promise.resolve();
    if (fail) throw new Error("synthetic network failure");
    return new Response(JSON.stringify({ openai: { models: { future: textModel("future") } } }));
  });
  await Promise.all([read("openai"), read("anthropic")]);
  assert.equal(fetches, 1);
  fail = true;
  await assert.rejects(read("openai", true), /synthetic network failure/);
  assert.deepEqual(await read("openai"), [{ id: "future", label: "future" }]);
  assert.equal(fetches, 2);
});

test("invalid directory responses fail instead of inventing selectable models", async () => {
  for (const response of [
    new Response("offline", { status: 503 }),
    new Response("[]"),
    new Response("invalid JSON"),
  ])
    await assert.rejects(createPublicModelCatalog(async () => response)("openai"));
});

test("ChatGPT subscription authentication does not borrow the OpenAI API catalog", async () => {
  const runtime = { checkAuth: async () => ({ type: "oauth" }) } as unknown as ModelRuntime;
  assert.deepEqual(await discoverPiModels("openai", runtime), { models: [], source: "sdk" });
});
