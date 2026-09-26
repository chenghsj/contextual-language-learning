import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CustomAgentConfigSchema, type CustomAgentConfig } from "@immersive/core";
import { customArgs, getCustomAgent, listCustomAgents, removeCustomAgent,
  resolveCustomExecutable, runCustomConfig, saveCustomAgent, importCustomAgent, testCustomConfig } from "./custom";

const ID = "custom-" + "b".repeat(24);
const echoScript = "let s=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => s+=c);" +
  "process.stdin.on('end',()=>process.stdout.write(JSON.stringify({response:JSON.stringify({echo:s})})))";
const stdinConfig: CustomAgentConfig = {
  id: ID, label: "Local fixture", executable: process.execPath,
  args: ["-e", echoScript], promptMode: "stdin", outputMode: "stdout-json",
};
test("custom CLI runs with stdin, normalizes wrapped JSON and preserves text without shell expansion", async () => {
  const text = "hello ; $(echo should-not-run) && {world}";
  const result = await runCustomConfig(stdinConfig, { provider: ID, modelId: "" },
    text, new AbortController().signal);
  assert.deepEqual(result, { echo: text });
  assert.match(await testCustomConfig(stdinConfig, ""), /valid JSON/);
  assert.equal(await resolveCustomExecutable("../bin/sh"), null);
});
test("custom model and prompt arguments stay distinct argv elements", () => {
  const config = CustomAgentConfigSchema.parse({
    ...stdinConfig, promptMode: "argument", modelArgument: "--model",
    args: ["--prompt", "{prompt}", "--output", "{output}"], outputMode: "file-json",
  });
  assert.deepEqual(customArgs(config, "a; echo b", "m; echo c", "/tmp/data.json"),
    ["--prompt", "a; echo b", "--output", "/tmp/data.json", "--model", "m; echo c"]);
});
test("custom CLI supports validated JSON file output without relying on stdout", async () => {
  const config = CustomAgentConfigSchema.parse({
    ...stdinConfig, outputMode: "file-json",
    args: ["-e", "require('node:fs').writeFileSync(process.argv[1],JSON.stringify({ok:true}))", "{output}"],
  });
  const result = await runCustomConfig(config, { provider: ID, modelId: "" },
    "test", new AbortController().signal);
  assert.deepEqual(result, { ok: true });
});
test("invalid CLI output never becomes a generated lesson", async () => {
  const bad = { ...stdinConfig, args: ["-e", "process.stdout.write('not-json')"] };
  await assert.rejects(() => runCustomConfig(bad, { provider: ID, modelId: "" },
    "test", new AbortController().signal), /invalid lesson JSON/);
});
test("local registry creates, edits and removes custom definitions without touching CLI files", {
  skip: process.platform !== "linux",
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), "custom-agent-registry-test-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = temp;
  try {
    assert.deepEqual(await listCustomAgents(), []);
    assert.equal((await saveCustomAgent(stdinConfig)).length, 1);
    assert.equal((await getCustomAgent(ID)).label, "Local fixture");
    await saveCustomAgent({ ...stdinConfig, label: "Updated" });
    assert.equal((await listCustomAgents())[0].label, "Updated");
    assert.deepEqual(await removeCustomAgent(ID), []);
    await assert.rejects(() => getCustomAgent(ID), /not registered/);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(temp, { recursive: true, force: true });
  }
});

test("Host creates unique import IDs and rejects supplied IDs and unsafe extra fields", {
  skip: process.platform !== "linux",
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), "custom-agent-import-test-"));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = temp;
  try {
    const { id: _unused, ...definition } = stdinConfig;
    const first = await importCustomAgent(definition);
    const second = await importCustomAgent(definition);
    assert.match(first.agent.id, /^custom-[a-f0-9]{24}$/);
    assert.notEqual(first.agent.id, second.agent.id);
    assert.equal(second.agents.length, 2);
    await assert.rejects(() => importCustomAgent({ ...definition, id: ID }), /Unrecognized key/);
    await assert.rejects(() => importCustomAgent({ ...definition, extra: "unsafe" }), /Unrecognized key/);
    await assert.rejects(() => importCustomAgent({ ...definition, promptMode: "argument" }), /requires/);
    await assert.rejects(() => importCustomAgent({ ...definition, executable: "not-a-real-cli-agent-test" }), /not found/);
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(temp, { recursive: true, force: true });
  }
});
