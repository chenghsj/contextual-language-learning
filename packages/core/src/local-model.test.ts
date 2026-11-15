import assert from "node:assert/strict";
import test from "node:test";
import { LocalModelConfigSchema, LocalModelInputSchema } from "./local-model";
import { HostRequestSchema } from "./protocol-schema";
import { HostMessageSchema } from "./native-messaging";

const config = {
  baseUrl: "http://localhost:11434/v1/",
  modelId: "qwen",
  contextWindow: 32768,
  maxTokens: 8192,
  reasoning: false,
};
test("local model settings validate addresses, capacities and literal credentials", () => {
  assert.equal(LocalModelConfigSchema.parse(config).baseUrl, "http://localhost:11434/v1");
  for (const baseUrl of [
    "invalid",
    "file:///etc/passwd",
    "https://user:secret@host/v1",
    "http://host/v1?key=secret",
    "http://host/#key",
  ]) {
    assert.equal(LocalModelConfigSchema.safeParse({ ...config, baseUrl }).success, false, baseUrl);
  }
  for (const change of [
    { modelId: " " },
    { maxTokens: 32769 },
    { contextWindow: 0 },
    { maxTokens: NaN },
  ])
    assert.equal(LocalModelConfigSchema.safeParse({ ...config, ...change }).success, false);
  assert.equal(LocalModelInputSchema.safeParse({ config, apiKey: "!run-command" }).success, false);
  assert.equal(LocalModelInputSchema.safeParse({ config, apiKey: "key\nheader" }).success, false);
  assert.equal(
    LocalModelInputSchema.parse({ config, apiKey: "$literal-key" }).apiKey,
    "$literal-key",
  );
});
test("local model requests cross Native Messaging and responses exclude the secret", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  for (const type of ["testLocalModelConfig", "setLocalModelConfig"])
    assert.equal(HostRequestSchema.parse({ id, type, config, apiKey: "private" }).type, type);
  const reply = HostMessageSchema.parse({
    id,
    type: "localModelConfig",
    config,
    hasApiKey: true,
    apiKey: "private",
  });
  assert.equal("apiKey" in reply, false);
});
