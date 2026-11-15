import test from "node:test";
import assert from "node:assert/strict";
import { PI_PROVIDER_IDS } from "./pi-providers";
import { modelCatalogSource, modelCatalogLookupUrl } from "./model-catalog";

test("every service has a lookup link and public IDs stay scoped to its authentication route", () => {
  for (const id of PI_PROVIDER_IDS)
    assert.equal(new URL(modelCatalogSource(id)!.lookupUrl).protocol, "https:", id);
  assert.equal(modelCatalogSource("openai")?.directoryId, "openai");
  assert.equal(modelCatalogSource("openai-codex")?.directoryId, null);
  assert.equal(modelCatalogSource("azure")?.directoryId, null);
  assert.equal(modelCatalogSource("github-copilot")?.directoryId, "github-copilot");
  assert.equal(
    modelCatalogSource("qwen-token-plan-individual-cn")?.directoryId,
    "alibaba-coding-plan-cn",
  );
  assert.equal(modelCatalogSource("qwen-token-plan-cn")?.directoryId, "alibaba-token-plan-cn");
  assert.equal(modelCatalogSource("unknown"), undefined);
  assert.equal(modelCatalogSource("toString"), undefined);
  assert.equal(
    modelCatalogLookupUrl("openai", "oauth"),
    modelCatalogSource("openai-codex")?.lookupUrl,
  );
  assert.equal(modelCatalogLookupUrl("openai", "api_key"), modelCatalogSource("openai")?.lookupUrl);
});
