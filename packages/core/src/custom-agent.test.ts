import assert from "node:assert/strict";
import test from "node:test";
import { CustomAgentConfigSchema, HostRequestSchema } from "./schema";

const valid = {
  id: "custom-" + "a".repeat(24), label: "My CLI", executable: "gemini",
  args: ["--output-format", "json"], promptMode: "stdin" as const,
  outputMode: "stdout-json" as const, modelArgument: "--model",
};
test("custom CLI config allows safe argv, stdin and optional profile environment", () => {
  const parsed = CustomAgentConfigSchema.parse({
    ...valid, profileEnvVar: "GEMINI_CLI_HOME",
    modelListArgs: ["models", "--format", "json"],
  });
  assert.equal(parsed.id, valid.id);
  assert.equal(parsed.profileEnvVar, "GEMINI_CLI_HOME");
  assert.ok(HostRequestSchema.safeParse({
    id: "83a3cf3b-477c-4efd-bc64-056e3f66c53e", type: "customAgentTest",
    config: parsed, modelId: "", accountConfigDir: "/home/user/.gemini",
  }).success);
});
test("custom CLI config enforces matching placeholders and profile variable shape", () => {
  const invalid = [
    { ...valid, promptMode: "argument", args: [] },
    { ...valid, args: ["{prompt}"] },
    { ...valid, outputMode: "file-json", args: [] },
    { ...valid, args: ["{output}"] },
    { ...valid, args: ["{unknown}"] },
    { ...valid, executable: "../../bin/sh" + "\n" },
    { ...valid, profileEnvVar: "NODE_OPTIONS" },
  ];
  for (const value of invalid) assert.equal(CustomAgentConfigSchema.safeParse(value).success, false);
  assert.ok(CustomAgentConfigSchema.safeParse({
    ...valid, args: ["-e", "process.stdout.write(JSON.stringify({ok:true}))"],
  }).success, "ordinary JSON braces in a CLI argument are not template placeholders");
});
