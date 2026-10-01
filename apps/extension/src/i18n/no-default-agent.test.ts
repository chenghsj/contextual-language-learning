import assert from "node:assert/strict";
import test from "node:test";
import { defaultPreferences } from "../lib/preferences-store";
import { AgentSettingsSchema } from "@immersive/core";
test("new settings explicitly have no selected provider", () => {
  assert.equal(defaultPreferences().agent, null);
  assert.equal(AgentSettingsSchema.safeParse({ provider: "", modelId: "" }).success, false);
});
