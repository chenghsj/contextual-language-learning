import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture.ts";
import { customFavoriteFixture } from "../../../packages/core/test/custom-favorite-fixture.ts";
import { FileCustomRepository } from "../src/storage/custom.ts";
import { localStoragePorts } from "../src/storage/file.ts";
import {
  learningDocumentToMarkdown,
  HOST_PROTOCOL_VERSION,
} from "../../../packages/core/src/index.ts";

const root = dirname(fileURLToPath(new URL("../", import.meta.url)));
const home = await mkdtemp(join(tmpdir(), "cll-favorites-host-"));
const evidence = join(home, "acceptance.json");
const dataRoot = join(home, "Documents", "Contextual Language Learning", "data-v7");
const document = pointsFixture().document;
const customDocument = customFavoriteFixture();
const customRoot = join(home, "Documents", "Contextual Language Learning", "custom-v1");
await localStoragePorts(dataRoot).documents.save(document, learningDocumentToMarkdown(document));
await new FileCustomRepository(customRoot).saveDocument(customDocument);
let child,
  stderr = "",
  buffer = Buffer.alloc(0);
const pending = new Map();
function start() {
  buffer = Buffer.alloc(0);
  stderr = "";
  child = spawn(process.execPath, [join(root, "local-host", "dist", "native-host.mjs")], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", chunk => {
    stderr += chunk;
  });
  child.stdout.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const size = buffer.readUInt32LE(0);
      const message = JSON.parse(buffer.subarray(4, 4 + size).toString("utf8"));
      buffer = buffer.subarray(4 + size);
      pending.get(message.id)?.(message);
    }
  });
  child.on("exit", code => {
    for (const resolve of pending.values())
      resolve({ type: "error", message: `Host exited ${code}: ${stderr}` });
    pending.clear();
  });
}
async function stop() {
  const current = child;
  await new Promise(resolve => {
    current.once("exit", resolve);
    current.stdin.end();
  });
}
function request(type, fields = {}) {
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Host request timeout: " + type + " " + stderr));
    }, 15000);
    pending.set(id, message => {
      pending.delete(id);
      clearTimeout(timer);
      if (message.type === "error") reject(new Error(message.message));
      else resolve(message);
    });
    const body = Buffer.from(JSON.stringify({ id, type, ...fields }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    child.stdin.write(Buffer.concat([header, body]));
  });
}
const collection = { kind: "local" };
try {
  start();
  assert.equal((await request("health")).protocolVersion, HOST_PROTOCOL_VERSION);
  const input = {
    collection,
    documentId: document.id,
    sceneId: document.sections[0].id,
    mutationId: randomUUID(),
    desired: true,
  };
  const added = await request("setFavorite", { input });
  assert.ok(added.favorite);
  const key = added.favorite.key;
  const customInput = {
    ...input,
    documentId: customDocument.id,
    sceneId: customDocument.id,
    mutationId: randomUUID(),
  };
  const customAdded = await request("setFavorite", { input: customInput });
  assert.equal(customAdded.favorite.kind, "custom");
  await stop();
  await rm(dataRoot, { recursive: true, force: true });
  await rm(customRoot, { recursive: true, force: true });
  start();
  const list = await request("listFavorites", { collection, query: { limit: 40 } });
  assert.equal(list.page.items.length, 2);
  const saved = await request("getFavorite", { collection, key });
  assert.equal(saved.snapshot.scene.title, document.sections[0].title);
  const customSaved = await request("getFavorite", { collection, key: customAdded.favorite.key });
  assert.equal(customSaved.snapshot.snapshotVersion, 2);
  assert.equal(customSaved.snapshot.document.markdown, customDocument.markdown);
  await request("setFavorite", {
    input: { ...customInput, desired: false, mutationId: randomUUID() },
  });
  assert.equal((await request("setFavorite", { input: customInput })).favorite, null);
  await request("setFavorite", { input: { ...input, desired: false, mutationId: randomUUID() } });
  assert.equal((await request("setFavorite", { input })).favorite, null);
  assert.equal(
    (await request("listFavorites", { collection, query: { limit: 40 } })).page.items.length,
    0,
  );
  const report = {
    productionHost: true,
    installedExtension: false,
    protocolVersion: HOST_PROTOCOL_VERSION,
    checks: [
      "Framed favorite write",
      "Host restart preserves favorite",
      "Original lesson removed, snapshot still reads",
      "Custom Markdown write, restart, source deletion and frozen read",
      "Old mutation retry does not undo later cancellation",
    ],
    dataRoot: home,
  };
  await writeFile(evidence, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ ...report, evidence }, null, 2) + "\n");
} finally {
  if (child?.exitCode === null) await stop();
}
