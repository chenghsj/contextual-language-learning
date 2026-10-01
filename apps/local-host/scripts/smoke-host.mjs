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
const v5Library = join(library, "data-v5");
await mkdir(library, { recursive: true });
const existingId = randomUUID();
const profile = {
  targetLanguage: "en",
  instructionLanguage: "zh-TW",
  level: "B1",
  sceneCount: 2,
  contextualExampleCount: 1,
};
// Historical development files remain untouched but are outside the V5 namespace.
const legacyAgent = { provider: "claude", modelId: "" };
const cues = [{ id: "cue-1", startMs: null, endMs: null, originalText: "Good morning." }];
await writeFile(
  join(library, existingId + ".json"),
  JSON.stringify({
    id: existingId,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    source: { platform: "import", title: "Existing lesson" },
    profile,
    generation: legacyAgent,
    cues,
    sections: [
      {
        id: randomUUID(),
        title: "Introduction",
        context: "Greetings",
        cueIds: ["cue-1"],
        startMs: null,
        endMs: null,
        vocabulary: [],
        insights: [],
        exercises: [],
      },
    ],
  }),
  { flag: "wx" },
);

const launcher = process.argv[2];
const child = spawn(launcher ?? process.execPath, launcher ? [] : [host], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    HOME: home,
    ...(process.platform === "win32"
      ? {
          USERPROFILE: home,
          APPDATA: join(home, "AppData", "Roaming"),
          LOCALAPPDATA: join(home, "AppData", "Local"),
        }
      : {}),
  },
  windowsHide: true,
});
let stdout = Buffer.alloc(0);
let stderr = "";
const awaiting = new Map();
child.stderr.on("data", data => {
  stderr = (stderr + String(data)).slice(-16000);
});
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
  for (const pending of awaiting.values())
    pending.reject(new Error("Native Host exited early (" + code + "): " + stderr));
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
  assert.equal(health.agentMode, "pi-sdk");
  assert.equal(health.protocolVersion, 4);
  assert.ok(health.agents.some(entry => entry.id === "openai"));
  assert.ok(
    health.agents.every(entry =>
      Object.keys(entry).every(key => ["id", "label", "installed"].includes(key)),
    ),
  );
  const providers = await send({ type: "piProviders", id: randomUUID() });
  assert.equal(providers.type, "piProviders");
  assert.deepEqual(providers.providers.find(entry => entry.id === "antigravity")?.methods, [
    "oauth",
  ]);
  assert.ok(providers.providers.every(entry => !entry.connected));
  const agent = { provider: "openai", modelId: "" };
  const models = await send({ type: "agentModels", id: randomUUID(), settings: agent });
  assert.equal(models.source, "sdk");
  assert.ok(models.models.length);
  const legacyModel = await send({ type: "agentModels", id: randomUUID(), settings: legacyAgent });
  assert.equal(legacyModel.type, "error");
  assert.ok(legacyModel.message.length);
  const payload = {
    id: randomUUID(),
    source: { platform: "import", title: "Same subtitle, new title" },
    profile,
    agent,
    destination: { kind: "local" },
    cues,
  };
  const check = await send({ type: "checkDuplicates", id: randomUUID(), payload });
  assert.equal(check.type, "duplicates");
  assert.deepEqual(check.matches, [], "old development files must not appear as V5 duplicates");
  assert.equal(typeof check.token, "string");

  const contextualId = randomUUID();
  const contextual = {
    id: contextualId,
    schemaVersion: 5,
    createdAt: new Date().toISOString(),
    source: payload.source,
    profile,
    generation: agent,
    cues,
    sections: [
      {
        id: randomUUID(),
        title: "Morning",
        context: "A greeting",
        cueIds: ["cue-1"],
        startMs: null,
        endMs: null,
        translations: [{ cueId: "cue-1", text: "早安。" }],
        focusItems: [
          {
            expression: "Good morning",
            sourceCueIds: ["cue-1"],
            meaning: "早安",
            contextExplanation: "A morning greeting",
            contextCueIds: ["cue-1"],
            wordNotes: [],
            examples: [
              {
                situation: "At home",
                dialogue: [
                  { text: "Good morning", translation: "早安" },
                  { text: "Morning", translation: "早" },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  // Saving through the grouped V5 folder layout is covered by repository tests.
  // Here a same-source V5 document checks the live Host duplicate path.
  const folder = join(v5Library, "videos", "import--smoke");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, contextualId + ".json"), JSON.stringify(contextual));
  const v5Check = await send({ type: "checkDuplicates", id: randomUUID(), payload });
  assert.ok(v5Check.matches.some(match => match.documentId === contextualId));
  const blocked = await send({
    type: "generate",
    id: payload.id,
    payload,
    checkToken: v5Check.token,
    confirmRegeneration: false,
  });
  assert.equal(blocked.type, "error");
  assert.match(blocked.message, /確認|生成過/);

  const invalidTicket = await send({
    type: "generate",
    id: randomUUID(),
    payload,
    checkToken: randomUUID(),
    confirmRegeneration: true,
  });
  assert.equal(invalidTicket.type, "error");
  assert.match(invalidTicket.message, /檢查/);
  await assert.rejects(access(join(library, "jobs", payload.id + ".json")), { code: "ENOENT" });
  assert.equal(
    JSON.parse(
      await import("node:fs/promises").then(fs =>
        fs.readFile(join(library, existingId + ".json"), "utf8"),
      ),
    ).schemaVersion,
    1,
  );
  process.stdout.write(
    "Native Host V5 protocol, old data isolation and duplicate confirmation OK\n",
  );
} finally {
  clearTimeout(deadline);
  child.kill();
  child.stdin.destroy();
  if (child.exitCode === null) await new Promise(resolveExit => child.once("exit", resolveExit));
  await rm(home, { recursive: true, force: true });
}
