import test from "node:test";
import assert from "node:assert/strict";
import type { Api, RefreshModelsContext } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  resetAntigravityCatalogForTests,
  getCurrentAntigravityCatalog,
  ANTIGRAVITY_PERSIST_KEY,
} from "pi-antigravity/src/models/index.js";
import { accountAntigravityCatalog, refreshAccountAntigravityModels } from "./antigravity-catalog";

const raw = {
  "gemini-3.8-flash-medium": { displayName: "Gemini 3.8 Flash (Medium)", supportsThinking: true },
};
const fakeFetch: Parameters<typeof refreshAccountAntigravityModels>[1] = async () => ({
  endpoint: "synthetic",
  status: 200,
  data: { models: raw },
});
const context = (): RefreshModelsContext => ({
  credential: {
    type: "api_key",
    key: JSON.stringify({ token: "synthetic", projectId: "synthetic" }),
  },
  allowNetwork: true,
  force: true,
  signal: new AbortController().signal,
  publish: async publication => {
    publication.update?.();
    return true;
  },
});
test("account catalog keeps only advertised models and effort levels, with known capacity metadata", () => {
  resetAntigravityCatalogForTests();
  const result = accountAntigravityCatalog(raw);
  assert.deepEqual(
    result.models.map(model => model.id),
    ["gemini-3.8-flash"],
  );
  const model = result.models[0];
  assert.ok(model.type === undefined || model.type === "chat");
  if (model.type === undefined || model.type === "chat") {
    assert.deepEqual(
      getSupportedThinkingLevels({
        ...model,
        provider: "antigravity",
        api: "antigravity-api" as Api,
        baseUrl: "https://example.test",
      }),
      ["medium"],
    );
    assert.equal(model.maxTokens, 65536);
  }
  assert.equal(result.routing["gemini-3.7-flash"], undefined);
  assert.deepEqual(accountAntigravityCatalog({}).models, []);
  assert.deepEqual(
    accountAntigravityCatalog({ "gemini-image": { displayName: "Image" } }).models,
    [],
  );
});
test("refresh publishes only current account candidates and cache-only startup retains an empty catalog", async () => {
  resetAntigravityCatalogForTests();
  try {
    let publication: Parameters<RefreshModelsContext["publish"]>[0];
    const ctx = context();
    ctx.publish = async p => {
      publication = p;
      p.update?.();
      return true;
    };
    const models = await refreshAccountAntigravityModels(ctx, fakeFetch);
    assert.deepEqual(
      models.map(m => m.id),
      ["gemini-3.8-flash"],
    );
    assert.deepEqual(
      publication!.persist?.models.map(m => m.id),
      ["gemini-3.8-flash"],
    );
    resetAntigravityCatalogForTests();
    ctx.allowNetwork = false;
    ctx.stored = {
      models: [],
      [ANTIGRAVITY_PERSIST_KEY]: {
        catalog: { models: [], routing: {} },
        checkedAt: Date.now(),
      },
    } as unknown as RefreshModelsContext["stored"];
    assert.deepEqual(
      await refreshAccountAntigravityModels(ctx, async () => {
        throw new Error("No network during cache-only startup");
      }),
      [],
    );
  } finally {
    resetAntigravityCatalogForTests();
  }
});
test("failed or superseded refresh does not remove cached models or claim a new catalog", async () => {
  resetAntigravityCatalogForTests();
  const before = getCurrentAntigravityCatalog();
  const ctx = context();
  await assert.rejects(
    refreshAccountAntigravityModels(ctx, async () => {
      throw new Error("HTTP 429");
    }),
    /429/,
  );
  assert.deepEqual(getCurrentAntigravityCatalog(), before);
  ctx.publish = async () => false;
  assert.deepEqual(await refreshAccountAntigravityModels(ctx, fakeFetch), before.models);
  assert.deepEqual(getCurrentAntigravityCatalog(), before);
});
