import assert from "node:assert/strict";
import test from "node:test";
import { AgentSettingsSchema, SourceSchema } from "./schema";

test("new providers can be represented without changing the document schema", () => {
  assert.equal(SourceSchema.parse({ platform: "apple-tv", title: "Example" }).platform, "apple-tv");
  assert.equal(AgentSettingsSchema.parse({ provider: "other-cli", modelId: "" }).provider, "other-cli");
});

test("invalid provider IDs are rejected before adapter lookup", () => {
  for (const provider of ["../../bin/bash", "bad provider", "", "some;command"]) {
    assert.equal(AgentSettingsSchema.safeParse({ provider, modelId: "" }).success, false);
  }
});
