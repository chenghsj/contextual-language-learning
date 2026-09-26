import assert from "node:assert/strict";
import test from "node:test";
import { CustomAgentDefinitionSchema, HostRequestSchema } from "./schema";

test("custom Agent definitions use a reserved custom ID namespace and argv fields", () => {
  const parsed = CustomAgentDefinitionSchema.parse({
    id: "custom-gemini", label: "Gemini CLI", executable: "gemini",
    args: ["--output-format", "json", "-p", "{prompt}"], modelArgument: "--model",
  });
  assert.equal(parsed.id, "custom-gemini");
  assert.throws(() => CustomAgentDefinitionSchema.parse({
    id: "claude", label: "Override", executable: "sh", args: [],
  }));
  assert.throws(() => CustomAgentDefinitionSchema.parse({
    id: "custom-bad", label: "Bad", executable: "tool", args: ["{prompt}", "{prompt}"],
  }), /prompt/);
});

test("Native Host accepts explicit custom Agent CRUD requests only", () => {
  const definition = {
    id: "custom-example", label: "Example", executable: "example", args: [],
  };
  assert.equal(HostRequestSchema.parse({
    id: "18c6bbab-60d7-4aaf-a592-955a450bea4b", type: "customAgentSave", definition,
  }).type, "customAgentSave");
  assert.equal(HostRequestSchema.parse({
    id: "18c6bbab-60d7-4aaf-a592-955a450bea4b", type: "customAgentRemove", agentId: "custom-example",
  }).type, "customAgentRemove");
});

test("advanced custom Agent transport options reject ambiguous or unsafe configurations", () => {
  assert.equal(CustomAgentDefinitionSchema.safeParse({
    id: "custom-stdin", label: "stdin", executable: "tool", args: [],
    promptMode: "stdin", outputMode: "stdout-json", timeoutSeconds: 60,
  }).success, true);
  assert.equal(CustomAgentDefinitionSchema.safeParse({
    id: "custom-file", label: "file", executable: "tool", args: ["--out", "{output}"],
    outputMode: "file-json", profileEnvVar: "MY_AGENT_HOME",
  }).success, true);
  assert.equal(CustomAgentDefinitionSchema.safeParse({
    id: "custom-bad-file", label: "file", executable: "tool", args: [], outputMode: "file-json",
  }).success, false);
  assert.equal(CustomAgentDefinitionSchema.safeParse({
    id: "custom-bad-env", label: "bad", executable: "tool", args: [], profileEnvVar: "NODE_OPTIONS",
  }).success, false);
});
