import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const host = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/native-host.mjs");
const home = await mkdtemp(join(tmpdir(), "immersive-host-smoke-"));
const library = join(home, "Documents", "Immersive Learning");
await mkdir(library, { recursive: true });
const existingId = randomUUID();
const profile = {
  targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
  mode: "guided", maxNewVocabulary: 3, exerciseCount: 1,
};
// Old document metadata remains readable even though the built-in adapter is removed.
const legacyAgent = { provider: "claude", modelId: "" };
const cues = [{ id: "cue-1", startMs: null, endMs: null, originalText: "Good morning." }];
await writeFile(join(library, existingId + ".json"), JSON.stringify({
  id: existingId, schemaVersion: 1, createdAt: new Date().toISOString(),
  source: { platform: "import", title: "Existing lesson" },
  profile, generation: legacyAgent, cues,
  sections: [{
    id: randomUUID(), title: "Introduction", context: "Greetings",
    cueIds: ["cue-1"], startMs: null, endMs: null,
    vocabulary: [], insights: [], exercises: [],
  }],
}), { flag: "wx" });

const launcher = process.argv[2];
const child = spawn(launcher ?? process.execPath, launcher ? [] : [host], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, HOME: home,
    ...(process.platform === "win32" ? { USERPROFILE: home,
      APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local") } : {}) },
  windowsHide: true,
});
let stdout = Buffer.alloc(0);
let stderr = "";
const awaiting = new Map();
child.stderr.on("data", data => { stderr = (stderr + String(data)).slice(-16000); });
child.stdout.on("data", data => {
  stdout = Buffer.concat([stdout, data]);
  while (stdout.length >= 4) {
    const size = stdout.readUInt32LE(0);
    if (size > 900_000) throw new Error("Oversized native response");
    if (stdout.length < size + 4) break;
    const message = JSON.parse(stdout.subarray(4, size + 4).toString("utf8"));
    stdout = stdout.subarray(size + 4);
    const match = awaiting.get(message.id);
    if (match) {
      awaiting.delete(message.id);
      match.resolve(message);
    }
  }
});
child.on("error", error => {
  for (const pending of awaiting.values()) pending.reject(error);
  awaiting.clear();
});
child.on("exit", code => {
  for (const pending of awaiting.values()) pending.reject(
    new Error("Native Host exited early (" + code + "): " + stderr),
  );
  awaiting.clear();
});

function send(message) {
  return new Promise((resolveMessage, reject) => {
    awaiting.set(message.id, { resolve: resolveMessage, reject });
    const body = Buffer.from(JSON.stringify(message));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

const deadline = setTimeout(() => {
  child.kill();
  process.stderr.write("Native Host smoke test timed out: " + stderr + "\n");
  process.exitCode = 1;
}, 15_000);

try {
  const health = await send({ type: "health", id: randomUUID() });
  assert.equal(health.type, "health");
  assert.equal(health.agentMode, "imported-only");
  // Installer smoke invokes the Host again; its imported CLI registry may already persist.
  assert.ok(health.agents.every(entry => /^custom-[a-f0-9]{24}$/.test(entry.id)),
    "Host must expose only user-imported CLI definitions");
  assert.deepEqual(Object.keys(health.installed).sort(), health.agents.map(entry => entry.id).sort(),
    "no removed built-in provider can appear in the Host catalog");
  const registration = await send({ id: randomUUID(), type: "customAgentImport", config: {
    label: "Smoke CLI", executable: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify({ok:true}))"],
    promptMode: "stdin", outputMode: "stdout-json",
  } });
  assert.equal(registration.type, "customAgentImported");
  assert.match(registration.agent.id, /^custom-[a-f0-9]{24}$/);
  const agent = { provider: registration.agent.id, modelId: "" };
  const afterImport = await send({ type: "health", id: randomUUID() });
  assert.ok(afterImport.agents.some(entry => entry.id === agent.provider));
  assert.equal(afterImport.installed[agent.provider], true);
  const legacyModel = await send({ type: "agentModels", id: randomUUID(),
    settings: legacyAgent });
  assert.equal(legacyModel.type, "error");
  assert.match(legacyModel.message, /no longer supported/);
  const payload = {
    id: randomUUID(), source: { platform: "import", title: "Same subtitle, new title" },
    profile, agent, destination: { kind: "local" }, cues,
  };
  const check = await send({ type: "checkDuplicates", id: randomUUID(), payload });
  assert.equal(check.type, "duplicates");
  assert.ok(check.matches.some(match => match.documentId === existingId));
  assert.equal(typeof check.token, "string");

  const blocked = await send({
    type: "generate", id: payload.id, payload,
    checkToken: check.token, confirmRegeneration: false,
  });
  assert.equal(blocked.type, "error");
  assert.match(blocked.message, /確認|生成過/);

  const invalidTicket = await send({
    type: "generate", id: randomUUID(), payload,
    checkToken: randomUUID(), confirmRegeneration: true,
  });
  assert.equal(invalidTicket.type, "error");
  assert.match(invalidTicket.message, /檢查/);
  await assert.rejects(access(join(library, "jobs", payload.id + ".json")), { code: "ENOENT" });
  process.stdout.write("Native Host imported-only health, historical duplicates and regeneration confirmation OK\n");
} finally {
  clearTimeout(deadline);
  child.kill();
  child.stdin.destroy();
  if (child.exitCode === null) await new Promise(resolveExit => child.once("exit", resolveExit));
  await rm(home, { recursive: true, force: true });
}
