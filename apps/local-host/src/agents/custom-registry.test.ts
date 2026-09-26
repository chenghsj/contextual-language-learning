import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appConfigRoot } from "../platform/paths";
import { listCustomAgents, removeCustomAgent, saveCustomAgent, testCustomAgentExecutable } from "./custom-registry";
import { expandCustomArgs, extractCustomAgentPayload, parseCustomAgentNdjson } from "./custom";

test("custom Agent registry stores definitions only and resolves a safe executable", async () => {
  const home = await mkdtemp(join(tmpdir(), "contextual-custom-agent-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  if (process.platform === "win32") {
    process.env.USERPROFILE = home;
    process.env.APPDATA = join(home, "AppData", "Roaming");
  }
  if (process.platform === "linux") process.env.XDG_CONFIG_HOME = join(home, ".config");
  try {
    const definition = {
      id: "custom-node-json", label: "Node JSON", executable: process.execPath,
      args: ["-e", "process.stdout.write('{}')"], modelArgument: "--model",
    };
    assert.equal((await saveCustomAgent(definition))[0].label, "Node JSON");
    assert.deepEqual(await listCustomAgents(), [definition]);
    assert.equal(await testCustomAgentExecutable(definition), process.execPath);
    const registry = join(appConfigRoot(), "custom-agents.json");
    assert.ok(!(await readFile(registry, "utf8")).includes("token"));
    if (process.platform !== "win32") assert.equal((await stat(registry)).mode & 0o777, 0o600);
    assert.deepEqual(await removeCustomAgent(definition.id), []);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
  }
});

test("custom Agent argv expansion never constructs a shell command", () => {
  const definition = {
    id: "custom-example", label: "Example", executable: "example",
    args: ["run", "--json", "{prompt}"], modelArgument: "--model",
  };
  assert.deepEqual(expandCustomArgs(definition, "hello; rm -rf /", "model-x"),
    ["run", "--json", "hello; rm -rf /", "--model", "model-x"]);
  assert.throws(() => expandCustomArgs({ ...definition, modelArgument: undefined }, "hi", "model-x"),
    /no model argument/);
});

test("custom Agent can unwrap structured CLI envelopes before lesson validation", () => {
  assert.deepEqual(extractCustomAgentPayload({ response: '{"title":"ok"}' }, "response"), { title: "ok" });
  assert.deepEqual(extractCustomAgentPayload({ data: { answer: { title: "ok" } } }, "data.answer"), { title: "ok" });
  assert.throws(() => extractCustomAgentPayload({}, "response"), /missing configured path/);
});

test("stdin/file placeholders and OpenCode-style NDJSON are deterministic", () => {
  const stdin = {
    id: "custom-stdin", label: "stdin", executable: "tool", args: [], promptMode: "stdin" as const,
  };
  assert.deepEqual(expandCustomArgs(stdin, "prompt", ""), []);
  const file = {
    id: "custom-file", label: "file", executable: "tool", args: ["--out", "{output}", "{prompt}"], outputMode: "file-json" as const,
  };
  assert.deepEqual(expandCustomArgs(file, "prompt", "", "/tmp/result.json"), ["--out", "/tmp/result.json", "prompt"]);
  const ndjson = [
    JSON.stringify({ type: "step_start", part: {} }),
    JSON.stringify({ type: "text", part: { text: '{"title":' } }),
    JSON.stringify({ type: "text", part: { text: '"ok"}' } }),
  ].join("\n");
  assert.deepEqual(parseCustomAgentNdjson(ndjson, "part.text"), { title: "ok" });
});
