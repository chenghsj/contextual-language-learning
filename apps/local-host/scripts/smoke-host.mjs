import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const host = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/native-host.mjs");
const home = await mkdtemp(join(tmpdir(), "contextual-host-smoke-"));
const library = join(home, "Documents", "Contextual Language Learning");
const v5Library = join(library, "data-v5");
const legacyLibrary = join(home, "Documents", "Immersive Learning");
const configBase =
  process.platform === "darwin"
    ? join(home, "Library", "Application Support")
    : process.platform === "win32"
      ? join(home, "AppData", "Roaming")
      : join(home, ".config");
const legacyConfig = join(
  configBase,
  process.platform === "linux" ? "immersive-language-learning" : "Immersive Learning",
);
const currentConfig = join(
  configBase,
  process.platform === "linux" ? "contextual-language-learning" : "Contextual Language Learning",
);
await mkdir(legacyLibrary, { recursive: true });
await mkdir(join(legacyConfig, "pi"), { recursive: true });
await writeFile(join(legacyConfig, "pi", "auth.json"), "{}\n", { mode: 0o600 });
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
  join(legacyLibrary, existingId + ".json"),
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
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
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
  // Empty historical auth files may be removed by the secure-storage migration.
  for (const config of [currentConfig, legacyConfig]) {
    try {
      assert.deepEqual(JSON.parse(await readFile(join(config, "pi", "auth.json"), "utf8")), {});
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await access(join(legacyLibrary, existingId + ".json"));
  await assert.rejects(access(join(library, existingId + ".json")), { code: "ENOENT" });
  assert.equal(health.agentMode, "pi-sdk");
  assert.equal(health.protocolVersion, 19);
  assert.ok(health.agents.some(entry => entry.id === "openai"));
  assert.ok(
    health.agents.every(entry =>
      Object.keys(entry).every(key => ["id", "label", "installed"].includes(key)),
    ),
  );
  const agent = { provider: "openai", modelId: "" };
  const providers = await send({ type: "piProviders", id: randomUUID() });
  if (providers.type === "error") {
    assert.match(providers.message, /credential|Keychain|Secret Service/i);
    // Headless Linux has no unlocked desktop secret service. Validate fail-closed
    // behavior while the rest of the Host smoke continues without AI credentials.
  } else {
    assert.equal(providers.type, "piProviders");
    assert.deepEqual(providers.providers.find(entry => entry.id === "openai")?.methodLabels, {
      oauth: "OpenAI (ChatGPT subscription)",
      api_key: "OpenAI API key",
    });
    assert.equal(
      providers.providers.length,
      43,
      "Host exposes all bundled providers plus Antigravity",
    );
    assert.deepEqual(
      providers.providers.map(provider => provider.id),
      health.agents.map(agent => agent.id),
    );
    assert.deepEqual(providers.providers.find(entry => entry.id === "antigravity")?.methods, [
      "oauth",
    ]);
    assert.ok(providers.providers.every(entry => !entry.connected));
    const models = await send({ type: "agentModels", id: randomUUID(), settings: agent });
    assert.equal(models.source, "sdk");
    assert.deepEqual(models.models, [], "Disconnected providers expose no SDK-available models");
  }
  const legacyModel = await send({ type: "agentModels", id: randomUUID(), settings: legacyAgent });
  assert.equal(legacyModel.type, "error");
  assert.ok(legacyModel.message.length);
  const payload = {
    id: randomUUID(),
    outputSchemaVersion: 7,
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
  assert.deepEqual(v5Check.matches, [], "retired lessons do not enter duplicate checks");
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
        fs.readFile(join(legacyLibrary, existingId + ".json"), "utf8"),
      ),
    ).schemaVersion,
    1,
  );
  const v7Id = randomUUID();
  const v7 = {
    id: v7Id,
    schemaVersion: 7,
    createdAt: new Date().toISOString(),
    source: payload.source,
    profile: { ...profile, enabledExplanations: [] },
    generation: { ...agent, modelId: "fixture" },
    execution: {
      workflowVersion: "learning-points-v7-1",
      promptVersion: "learning-points-prompts-12",
      schemaVersion: "7",
      languageStrategyVersion: "learning-language-strategies-4",
      levelStrategyVersion: "learning-level-strategies-1",
      qualityStrategyVersion: "learning-quality-1",
      inputFingerprint: "0".repeat(64),
      provider: agent.provider,
      modelId: "fixture",
      contextWindow: 128000,
      maxOutputTokens: 8192,
      chunkPlan: [cues.map(c => c.id)],
      calls: [],
    },
    cues,
    sections: [
      {
        id: randomUUID(),
        title: "A simple greeting",
        context: { text: "A greeting with no extra teaching needed.", evidenceCueIds: ["cue-1"] },
        cueIds: ["cue-1"],
        contextCueIds: [],
        startMs: null,
        endMs: null,
        translations: [{ cueId: "cue-1", text: "早安。" }],
        utterances: [
          {
            id: randomUUID(),
            cueIds: ["cue-1"],
            sourceSpans: [{ cueId: "cue-1", start: 0, end: cues[0].originalText.length }],
            meaning: "早安。",
            contextExplanation: "問候對方。",
            contextCueIds: [],
            decision: "basic_only",
            pointIds: [],
          },
        ],
      },
    ],
    points: [],
    reusableItems: [],
  };
  const v7Folder = join(library, "data-v7", "videos", "import--v7-smoke");
  await mkdir(v7Folder, { recursive: true });
  await writeFile(join(v7Folder, v7Id + ".json"), JSON.stringify(v7));
  const lessons = await send({ id: randomUUID(), type: "listLessons" });
  assert.deepEqual(lessons.lessons.map(item => item.schemaVersion).sort(), [7]);
  assert.equal(lessons.lessons.find(item => item.documentId === v7Id).pointCount, 0);
  const v7Read = await send({ id: randomUUID(), type: "getDocument", documentId: v7Id });
  assert.equal(v7Read.type, "result");
  assert.deepEqual(v7Read.document, v7);
  const calibrated = await send({
    id: randomUUID(),
    type: "savePlaybackRange",
    documentId: v7Id,
    cueId: "cue-1",
    range: { startMs: 0, endMs: 2000 },
  });
  assert.equal(calibrated.type, "playbackRangeSaved");
  const changed = JSON.parse(await readFile(join(v7Folder, v7Id + ".json"), "utf8"));
  assert.equal(changed.schemaVersion, 7);
  assert.deepEqual(changed.cues, cues);
  assert.equal(changed.playbackOverrides["cue-1"].endMs, 2000);
  const customId = randomUUID();
  const customRequest = {
    id: customId,
    kind: "custom",
    source: { platform: "import", title: "Custom smoke" },
    agent,
    cues,
    prompt: "Summarize",
    context: { subtitles: true, title: true },
    backup: { enabled: false },
  };
  const customCheck = await send({
    id: randomUUID(),
    type: "checkCustomDuplicates",
    payload: customRequest,
  });
  assert.equal(customCheck.type, "duplicates");
  assert.deepEqual(customCheck.matches, []);
  const execution = {
    workflowVersion: "custom-markdown-1",
    promptVersion: "custom-prompt-1",
    schemaVersion: "custom-v1",
    inputFingerprint: "a".repeat(64),
    provider: "openai",
    modelId: "fixture",
    contextWindow: 16384,
    maxOutputTokens: 4096,
    chunkPlan: [["cue-1"]],
    calls: [],
  };
  const markdown = "# Native custom smoke\n\nSaved Markdown.";
  const metadata = {
    schemaVersion: "custom-v1",
    kind: "custom",
    id: customId,
    title: "Custom smoke",
    createdAt: new Date().toISOString(),
    request: customRequest,
    execution,
    markdownHash: createHash("sha256").update(markdown).digest("hex"),
  };
  const customFolder = join(library, "custom-v1", "documents", customId);
  await mkdir(customFolder, { recursive: true });
  await writeFile(join(customFolder, "content.md"), markdown);
  await writeFile(join(customFolder, "metadata.json"), JSON.stringify(metadata));
  const customList = await send({ id: randomUUID(), type: "listCustomDocuments" });
  assert.equal(customList.type, "customDocuments");
  assert.equal(customList.documents[0].documentId, customId);
  const customRead = await send({
    id: randomUUID(),
    type: "getCustomDocument",
    documentId: customId,
  });
  assert.equal(customRead.type, "customChunk");
  assert.equal(customRead.total, 1);
  assert.equal(JSON.parse(Buffer.from(customRead.dataBase64, "base64")).markdown, markdown);
  const customRename = await send({
    id: randomUUID(),
    type: "renameCustomDocument",
    documentId: customId,
    title: "Renamed custom smoke",
  });
  assert.equal(customRename.type, "customDocumentChanged");
  assert.equal(
    (await send({ id: randomUUID(), type: "listCustomDocuments" })).documents[0].title,
    "Renamed custom smoke",
  );
  const customDelete = await send({
    id: randomUUID(),
    type: "deleteCustomDocument",
    documentId: customId,
  });
  assert.equal(customDelete.type, "customDocumentChanged");
  assert.deepEqual((await send({ id: randomUUID(), type: "listCustomDocuments" })).documents, []);
  assert.equal(
    (await send({ id: randomUUID(), type: "getJobExecution", jobId: randomUUID() })).execution,
    null,
  );
  process.stdout.write(
    "Native Host protocol 19, current-only library/read/calibration, custom-v1 read/rename/delete, old data isolation and duplicate confirmation OK\n",
  );
} finally {
  clearTimeout(deadline);
  child.kill();
  child.stdin.destroy();
  if (child.exitCode === null) await new Promise(resolveExit => child.once("exit", resolveExit));
  await rm(home, { recursive: true, force: true });
}
