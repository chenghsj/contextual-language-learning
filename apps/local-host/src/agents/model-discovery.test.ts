import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostRequestSchema, HostMessageSchema } from "@contextual/core";
import {
  getCurrentAntigravityCatalog,
  resetAntigravityCatalogForTests,
} from "pi-antigravity/src/models/index.js";
import { discoverAccountAntigravityModels } from "./antigravity-catalog";
import { discoverPiModels } from "./pi";
import { createTestPiRuntime } from "./credentials-test-support";

test("discovery includes uncurated exact IDs, maps known families and excludes non-chat/internal/disabled candidates", async () => {
  resetAntigravityCatalogForTests();
  const before = structuredClone(getCurrentAntigravityCatalog());
  const signal = new AbortController().signal;
  const found = await discoverAccountAntigravityModels(
    JSON.stringify({ token: "synthetic", projectId: "synthetic-project" }),
    signal,
    async (token, projectId, receivedSignal) => {
      assert.equal(token, "synthetic");
      assert.equal(projectId, "synthetic-project");
      assert.equal(receivedSignal, signal);
      return {
        endpoint: "synthetic",
        status: 200,
        data: {
          models: {
            "gemini-4-hydrogen-high": {
              displayName: "Gemini 4 Hydrogen (High)",
              supportsThinking: true,
            },
            "future-chat-high": { displayName: "Future Chat (High)" },
            "internal-chat": { isInternal: true },
            "private-chat": { apiProvider: "API_PROVIDER_INTERNAL" },
            "future-image": { displayName: "Future Image" },
            "future-disabled": { displayName: "Future Disabled" },
            "future-hidden": { displayName: "Future Hidden", disabled: true },
            "bad id": { displayName: "Invalid" },
          },
          agentModelSorts: [{ groups: [{ modelIds: ["gemini-4-hydrogen-high"] }] }],
        },
      };
    },
  );
  assert.deepEqual(
    found.map(model => model.id),
    ["future-chat-high", "gemini-4-hydrogen-high"],
  );
  assert.equal(found[0].label, "Future Chat (High)");
  assert.equal(found[0].catalogId, "future-chat");
  assert.equal(found[1].catalogId, "gemini-4-hydrogen");
  assert.deepEqual(
    getCurrentAntigravityCatalog(),
    before,
    "discovery must not publish or replace the curated catalog",
  );
  const reply = {
    id: crypto.randomUUID(),
    type: "discoveredModels",
    models: found,
    source: "account",
  };
  assert.equal(HostMessageSchema.safeParse(reply).success, true);
  assert.equal(
    HostRequestSchema.safeParse({
      id: crypto.randomUUID(),
      type: "discoverModels",
      provider: "unknown-service",
    }).success,
    false,
  );
});

test("alternative runtime IDs keep their family even when curated routing prefers a reasoning variant", async () => {
  const found = await discoverAccountAntigravityModels(
    JSON.stringify({ token: "synthetic", projectId: "synthetic" }),
    new AbortController().signal,
    async () => ({
      endpoint: "synthetic",
      status: 200,
      data: {
        models: {
          "gemini-3.8-flash-tiered": { displayName: "Gemini 3.8 Flash" },
          "gemini-3.8-flash-medium": { displayName: "Gemini 3.8 Flash (Medium)" },
        },
      },
    }),
  );
  assert.equal(found.find(model => model.id.endsWith("-tiered"))?.catalogId, "gemini-3.8-flash");
});

test("discovery uses normal account authentication and only calls catalog endpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-discovery-"));
  const originalFetch = globalThis.fetch;
  let queries = 0;
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
      assert.ok(
        String(input).includes("fetchAvailableModels"),
        "no generation or other network calls",
      );
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic");
      queries++;
      return new Response(
        JSON.stringify({
          models: { "future-exact-id-high": { displayName: "Future model (High)" } },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const runtime = await createTestPiRuntime(root);
    const before = runtime.getModels("antigravity").map(model => model.id);
    const found = await discoverPiModels("antigravity", runtime);
    assert.equal(found.models[0].id, "future-exact-id-high");
    assert.equal(found.source, "account");
    assert.ok(queries > 0);
    assert.deepEqual(
      runtime.getModels("antigravity").map(model => model.id),
      before,
    );
    globalThis.fetch = async () => {
      throw new Error("synthetic network failure");
    };
    await assert.rejects(discoverPiModels("antigravity", runtime), /fetchAvailableModels failed/);
    assert.deepEqual(
      runtime.getModels("antigravity").map(model => model.id),
      before,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
    resetAntigravityCatalogForTests();
  }
});

test("discovery preserves empty results and rejects missing data and cancellation", async () => {
  const key = JSON.stringify({ token: "synthetic", projectId: "synthetic-project" });
  assert.deepEqual(
    await discoverAccountAntigravityModels(key, new AbortController().signal, async () => ({
      endpoint: "synthetic",
      status: 200,
      data: { models: {} },
    })),
    [],
  );
  await assert.rejects(
    discoverAccountAntigravityModels(key, new AbortController().signal, async () => ({
      endpoint: "synthetic",
      status: 200,
      data: {},
    })),
    /could not be confirmed/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    discoverAccountAntigravityModels(key, controller.signal, async () => ({
      endpoint: "synthetic",
      status: 200,
      data: { models: {} },
    })),
    { name: "AbortError" },
  );
});
