import assert from "node:assert/strict";
import test from "node:test";
import { AgentSettingsSchema, SourceSchema } from "./schema";

test("supported video platforms and SDK providers use explicit contracts", () => {
  assert.equal(SourceSchema.parse({ platform: "apple-tv", title: "Example" }).platform, "apple-tv");
  assert.equal(AgentSettingsSchema.parse({ provider: "openai", modelId: "" }).provider, "openai");
  assert.equal(
    AgentSettingsSchema.safeParse({ provider: "other-cli", modelId: "" }).success,
    false,
  );
});

test("invalid provider IDs are rejected before adapter lookup", () => {
  for (const provider of ["../../bin/bash", "bad provider", "", "some;command"]) {
    assert.equal(AgentSettingsSchema.safeParse({ provider, modelId: "" }).success, false);
  }
});
