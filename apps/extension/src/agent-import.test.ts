import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_CONFIG_PROMPT, parseAgentImport } from "./agent-import";

const config = {
  label: "Sample CLI",
  executable: "sample-cli",
  args: ["run", "--last-message", "{output}", "-"],
  promptMode: "stdin",
  outputMode: "file-json",
  modelArgument: "--model",
  profileEnvVar: "SAMPLE_CLI_CONFIG_HOME",
};

test("one provider-neutral English BYO prompt specifies a fixed JSON contract", () => {
  assert.match(AGENT_CONFIG_PROMPT, /Return exactly one JSON object/);
  assert.match(AGENT_CONFIG_PROMPT, /"label": "Your CLI Agent name"/);
  assert.match(AGENT_CONFIG_PROMPT, /"executable": "your-cli"/);
  assert.match(AGENT_CONFIG_PROMPT, /"args": \["\{prompt\}"\]/);
  assert.match(AGENT_CONFIG_PROMPT, /"promptMode": "argument"/);
  assert.match(AGENT_CONFIG_PROMPT, /"outputMode": "stdout-json"/);
  for (const key of ["modelArgument", "modelListArgs", "profileEnvVar"]) {
    assert.ok(AGENT_CONFIG_PROMPT.includes(key), key);
  }
  assert.match(AGENT_CONFIG_PROMPT, /Do not execute commands, use tools/);
  assert.match(AGENT_CONFIG_PROMPT, /browse documentation, or test the CLI/);
  assert.match(AGENT_CONFIG_PROMPT, /credentials, tokens, passwords/);
  assert.match(AGENT_CONFIG_PROMPT, /"error": "Cannot verify CLI configuration"/);
  assert.match(AGENT_CONFIG_PROMPT, /"missing": \[/);
  assert.doesNotMatch(AGENT_CONFIG_PROMPT,
    /\b(?:Codex|Claude|AGY|Antigravity|Gemini|OpenCode)\b/i);
});

test("final-message JSON transport is not confused with the CLI's event stream", () => {
  assert.match(AGENT_CONFIG_PROMPT, /FINAL assistant response, not every CLI event/);
  assert.match(AGENT_CONFIG_PROMPT, /A JSONL event stream alone is not supported/);
  assert.match(AGENT_CONFIG_PROMPT, /last assistant message qualifies/);
  assert.match(AGENT_CONFIG_PROMPT, /validate the\s+final response/);
  assert.match(AGENT_CONFIG_PROMPT, /Include \{output\} in args only for this mode/);
  assert.deepEqual(parseAgentImport(JSON.stringify(config)), config);
  assert.deepEqual(parseAgentImport(JSON.stringify({
    label: "Another CLI", executable: "another-cli", args: ["--print", "{prompt}"],
    promptMode: "argument", outputMode: "stdout-json",
  })).outputMode, "stdout-json");
});

test("import accepts a JSON object and fenced JSON", () => {
  assert.equal(parseAgentImport(JSON.stringify(config)).executable, "sample-cli");
  const fence = String.fromCharCode(96).repeat(3);
  assert.equal(parseAgentImport(fence + "json\n" + JSON.stringify(config) + "\n" + fence).label,
    "Sample CLI");
});

test("import rejects supplied IDs, unknown fields and invalid placeholders", () => {
  assert.throws(() => parseAgentImport(JSON.stringify({
    ...config, id: "custom-" + "a".repeat(24),
  })), /Unrecognized/);
  assert.throws(() => parseAgentImport(JSON.stringify({
    ...config, args: ["run"],
  })), /requires/);
  assert.throws(() => parseAgentImport(JSON.stringify({
    error: "Cannot verify CLI configuration",
  })), /Cannot verify/);
  assert.throws(() => parseAgentImport(" ".repeat(32_001)), /too large/);
});
