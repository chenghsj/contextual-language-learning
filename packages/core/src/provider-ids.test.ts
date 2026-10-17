import assert from "node:assert/strict";
import test from "node:test";
import { AgentSettingsSchema, SourceSchema } from "./schema";
import { PI_PROVIDER_IDS } from "./pi-providers";

test("supported video platforms and SDK providers use explicit contracts", () => {
  assert.equal(SourceSchema.parse({ platform: "apple-tv", title: "Example" }).platform, "apple-tv");
  assert.equal(AgentSettingsSchema.parse({ provider: "openai", modelId: "" }).provider, "openai");
  assert.equal(
    AgentSettingsSchema.safeParse({ provider: "other-cli", modelId: "" }).success,
    false,
  );
});

test("every advertised Pi service can be saved as a generation provider", () => {
  for (const provider of PI_PROVIDER_IDS) {
    assert.equal(AgentSettingsSchema.parse({ provider, modelId: "" }).provider, provider);
  }
});

test("invalid provider IDs are rejected before adapter lookup", () => {
  for (const provider of ["../../bin/bash", "bad provider", "", "some;command"]) {
    assert.equal(AgentSettingsSchema.safeParse({ provider, modelId: "" }).success, false);
  }
});
