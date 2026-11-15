import test from "node:test";
import assert from "node:assert/strict";
import type { Api, ModelsStoreEntry, RefreshModelsContext } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  resetAntigravityCatalogForTests,
  getCurrentAntigravityCatalog,
  ANTIGRAVITY_PERSIST_KEY,
  applyAntigravityCatalog,
  getAntigravityRequestModelId,
} from "pi-antigravity/src/models/index.js";
import { mergeAvailableModelsResults } from "pi-antigravity/src/client/index.js";
import { accountAntigravityCatalog, refreshAccountAntigravityModels } from "./antigravity-catalog";

const raw = {
  "gemini-3.8-flash-medium": {
    displayName: "Gemini 3.8 Flash (Medium)",
    supportsThinking: true,
  },
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
test("refresh keeps Hydrogen recommended by daily endpoints when production has an older catalog", async () => {
  resetAntigravityCatalogForTests();
  try {
    const hydrogen = {
      "gemini-4-hydrogen-medium": {
        displayName: "Gemini 4 Hydrogen (Medium)",
        supportsThinking: true,
      },
    };
    const argon = {
      "gemini-4-argon-medium": {
        displayName: "Gemini 4 Argon (Medium)",
        supportsThinking: true,
      },
    };
    const sorts = (ids: string[]) => [{ displayName: "Recommended", groups: [{ modelIds: ids }] }];
    const merged = mergeAvailableModelsResults([
      {
        endpoint: "https://daily.example.test",
        status: 200,
        data: {
          models: { ...hydrogen, ...argon },
          agentModelSorts: sorts([...Object.keys(hydrogen), ...Object.keys(argon)]),
        },
      },
      {
        endpoint: "https://production.example.test",
        status: 200,
        data: { models: argon, agentModelSorts: sorts(Object.keys(argon)) },
      },
    ]);
    const models = await refreshAccountAntigravityModels(context(), async () => merged);
    assert.deepEqual(models.map(model => model.id).sort(), ["gemini-4-argon", "gemini-4-hydrogen"]);
    assert.deepEqual(
      merged.data.agentModelSorts,
      sorts([...Object.keys(hydrogen), ...Object.keys(argon)]),
    );
    assert.equal(
      mergeAvailableModelsResults([
        { endpoint: "https://catalog.example.test", status: 200, data: { models: argon } },
      ]).data.agentModelSorts,
      undefined,
    );
  } finally {
    resetAntigravityCatalogForTests();
  }
});
test("Hydrogen XHigh remains one selectable model and routes to the advertised effort", () => {
  resetAntigravityCatalogForTests();
  try {
    const levels = ["low", "medium", "high", "xhigh"];
    const catalog = accountAntigravityCatalog(
      Object.fromEntries(
        levels.map(level => [
          `gemini-4-hydrogen-${level}`,
          { displayName: `Gemini 4 Hydrogen (${level})`, supportsThinking: true },
        ]),
      ),
    );
    assert.deepEqual(
      catalog.models.map(model => model.id),
      ["gemini-4-hydrogen"],
    );
    const model = catalog.models[0];
    if (model.type === undefined || model.type === "chat") {
      assert.deepEqual(
        getSupportedThinkingLevels({
          ...model,
          provider: "antigravity",
          api: "antigravity-api" as Api,
          baseUrl: "https://example.test",
        }),
        levels,
      );
    }
    applyAntigravityCatalog(catalog);
    for (const level of levels)
      assert.equal(
        getAntigravityRequestModelId("gemini-4-hydrogen", level),
        `gemini-4-hydrogen-${level}`,
      );
  } finally {
    resetAntigravityCatalogForTests();
  }
});
test("disabled rollout placeholders are excluded from the account model catalog", () => {
  resetAntigravityCatalogForTests();
  assert.deepEqual(
    accountAntigravityCatalog({ "gemini-4-carbon-disabled": { displayName: "Gemini 4 Carbon" } }),
    { models: [], routing: {} },
  );
});
test("Hydrogen and Oxygen are discovered outside recommendations while disabled variants stay excluded", () => {
  resetAntigravityCatalogForTests();
  try {
    const catalog = accountAntigravityCatalog(
      {
        "gemini-4-argon-medium": { displayName: "Gemini 4 Argon (Medium)" },
        "gemini-4-hydrogen-xhigh": {
          displayName: "Gemini 4 Hydrogen (X-High)",
          supportsThinking: true,
        },
        "gemini-4-oxygen-high": { displayName: "Gemini 4 Oxygen (High)", supportsThinking: true },
        "gemini-4-oxygen-low": { displayName: "Gemini 4 Oxygen (Low)", disabled: true },
        "gemini-4-carbon-medium": { displayName: "Gemini 4 Carbon (Medium)", disabled: true },
        "gemini-future-unlisted": { displayName: "Other unlisted model" },
      },
      getCurrentAntigravityCatalog(),
      [{ groups: [{ modelIds: ["gemini-4-argon-medium", "gemini-4-carbon-medium"] }] }],
    );
    assert.deepEqual(catalog.models.map(model => model.id).sort(), [
      "gemini-4-argon",
      "gemini-4-hydrogen",
      "gemini-4-oxygen",
    ]);
    assert.deepEqual(
      catalog.models.find(model => model.id === "gemini-4-hydrogen")?.thinkingLevelMap?.xhigh,
      "xhigh",
    );
    assert.equal(
      catalog.models.find(model => model.id === "gemini-4-oxygen")?.thinkingLevelMap?.low,
      null,
    );
    applyAntigravityCatalog(catalog);
    assert.equal(
      getAntigravityRequestModelId("gemini-4-hydrogen", "xhigh"),
      "gemini-4-hydrogen-xhigh",
    );
    assert.equal(getAntigravityRequestModelId("gemini-4-oxygen", "high"), "gemini-4-oxygen-high");
  } finally {
    resetAntigravityCatalogForTests();
  }
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
  assert.deepEqual(accountAntigravityCatalog({}), { models: [], routing: {} });
  assert.deepEqual(
    accountAntigravityCatalog({
      "internal-model": { displayName: "Internal", isInternal: true },
      "hidden-model": {
        displayName: "Hidden",
        apiProvider: "API_PROVIDER_INTERNAL",
      },
    }),
    { models: [], routing: {} },
  );
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

test("refresh uses curated routes and advertised token limits instead of static defaults", async () => {
  resetAntigravityCatalogForTests();
  try {
    const models = await refreshAccountAntigravityModels(context(), async () => ({
      endpoint: "synthetic",
      status: 200,
      data: {
        models: {
          "gemini-3.8-flash-medium": {
            displayName: "Gemini 3.8 Flash (Medium)",
            supportsThinking: true,
            maxTokens: 32000,
            maxOutputTokens: 4096,
          },
          "gemini-3.8-flash-high": {
            displayName: "Gemini 3.8 Flash (High)",
            supportsThinking: true,
            maxTokens: 24000,
            maxOutputTokens: 2048,
          },
          "gemini-pro-agent": { displayName: "Retired Gemini Pro" },
        },
        agentModelSorts: [
          {
            groups: [
              {
                modelIds: ["gemini-3.8-flash-medium", "gemini-3.8-flash-high"],
              },
            ],
          },
        ],
      },
    }));
    assert.deepEqual(
      models.map(model => model.id),
      ["gemini-3.8-flash"],
    );
    const model = models[0];
    assert.ok(model.type === undefined || model.type === "chat");
    if (model.type === undefined || model.type === "chat") {
      assert.equal(model.contextWindow, 24000);
      assert.equal(model.maxTokens, 2048);
    }
    assert.equal(getCurrentAntigravityCatalog().routing["gemini-pro-agent"], undefined);
  } finally {
    resetAntigravityCatalogForTests();
  }
});

test("accepted empty refresh replaces the old account catalog and survives offline restart", async () => {
  resetAntigravityCatalogForTests();
  try {
    await refreshAccountAntigravityModels(context(), fakeFetch);
    const before = getCurrentAntigravityCatalog();
    assert.equal(before.models.length, 1);
    let stored: ModelsStoreEntry | undefined;
    const ctx = context();
    ctx.publish = async publication => {
      assert.deepEqual(getCurrentAntigravityCatalog(), before);
      assert.deepEqual(publication.persist?.models, []);
      if (publication.persist) stored = publication.persist;
      publication.update?.();
      return true;
    };
    assert.deepEqual(
      await refreshAccountAntigravityModels(ctx, async () => ({
        endpoint: "synthetic",
        status: 200,
        data: { models: {} },
      })),
      [],
    );
    assert.deepEqual(getCurrentAntigravityCatalog(), {
      models: [],
      routing: {},
    });
    assert.ok(stored);
    resetAntigravityCatalogForTests();
    ctx.allowNetwork = false;
    ctx.stored = stored;
    assert.deepEqual(
      await refreshAccountAntigravityModels(ctx, async () => {
        throw new Error("No network during cache-only startup");
      }),
      [],
    );
    assert.deepEqual(getCurrentAntigravityCatalog(), {
      models: [],
      routing: {},
    });
  } finally {
    resetAntigravityCatalogForTests();
  }
});

test("superseded empty refresh preserves the published account catalog", async () => {
  resetAntigravityCatalogForTests();
  try {
    await refreshAccountAntigravityModels(context(), fakeFetch);
    const before = getCurrentAntigravityCatalog();
    const ctx = context();
    ctx.publish = async () => false;
    assert.deepEqual(
      await refreshAccountAntigravityModels(ctx, async () => ({
        endpoint: "synthetic",
        status: 200,
        data: { models: {} },
      })),
      before.models,
    );
    assert.deepEqual(getCurrentAntigravityCatalog(), before);
  } finally {
    resetAntigravityCatalogForTests();
  }
});
