import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_CONFIG_PROMPT, parseAgentImport } from "./agent-import";

const config = { label:"Codex CLI", executable:"codex", args:["exec","--output-last-message","{output}","-"],
  promptMode:"stdin", outputMode:"file-json", modelArgument:"--model", profileEnvVar:"CODEX_HOME" };
test("fixed BYO prompt explains placeholders without collecting credentials", () => {
  assert.match(AGENT_CONFIG_PROMPT, /{prompt}/);
  assert.match(AGENT_CONFIG_PROMPT, /{output}/);
  assert.match(AGENT_CONFIG_PROMPT, /modelListArgs/);
  assert.match(AGENT_CONFIG_PROMPT, /credentials/);
  assert.match(AGENT_CONFIG_PROMPT, /Do NOT use tools, run shell commands/);
  assert.match(AGENT_CONFIG_PROMPT, /read documentation or --help/);
  assert.match(AGENT_CONFIG_PROMPT, /Do not execute anything/);
  assert.match(AGENT_CONFIG_PROMPT, /Return exactly ONE valid JSON object/);
  assert.match(AGENT_CONFIG_PROMPT, /"promptMode": "argument"/);
  assert.match(AGENT_CONFIG_PROMPT, /"outputMode": "stdout-json"/);
  assert.match(AGENT_CONFIG_PROMPT, /"missing": \[/);
  assert.doesNotMatch(AGENT_CONFIG_PROMPT, /Determine the actual executable.*--help/);
});
test("import accepts a JSON object and fenced JSON", () => {
  assert.equal(parseAgentImport(JSON.stringify(config)).executable,"codex");
  const fence=String.fromCharCode(96).repeat(3);
  assert.equal(parseAgentImport(fence+"json\n"+JSON.stringify(config)+"\n"+fence).label,"Codex CLI");
});
test("import rejects AI-supplied IDs, unknown fields and invalid placeholders", () => {
  assert.throws(() => parseAgentImport(JSON.stringify({...config,id:"custom-"+"a".repeat(24)})),/Unrecognized/);
  assert.throws(() => parseAgentImport(JSON.stringify({...config,args:["exec"]})),/requires/);
  assert.throws(() => parseAgentImport(JSON.stringify({error:"Cannot verify CLI configuration"})),/Cannot verify/);
  assert.throws(() => parseAgentImport(" ".repeat(32_001)),/too large/);
});
