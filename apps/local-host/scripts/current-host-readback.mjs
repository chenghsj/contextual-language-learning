/** Verify the installed Host against individually accepted current-generation lessons. */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import assert from "node:assert/strict";
import {
  HOST_PROTOCOL_VERSION,
  currentLearningExecution,
  readLearningDocument,
} from "@contextual/core";
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const acceptancePath = option("acceptance");
if (!acceptancePath)
  throw new Error("Run with node --import tsx and --acceptance=<acceptance.json>");
const accepted = JSON.parse(await readFile(resolve(acceptancePath), "utf8"));
assert.ok(accepted.cases?.length, "Acceptance must identify current generated documents");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const expected = await Promise.all(
  accepted.cases.map(async entry => {
    assert.equal(entry.structural, "passed");
    assert.equal(entry.semantic, "passed");
    const bytes = await readFile(resolve(dirname(acceptancePath), entry.documentPath));
    assert.equal(hash(bytes), entry.documentHash);
    const doc = readLearningDocument(JSON.parse(bytes));
    assert.equal(doc.id, entry.id);
    assert.ok(currentLearningExecution(doc.execution));
    return doc;
  }),
);
const extensionId = "agkdfdbgkoeooffhfkonpdkgfeldjifi",
  name = "dev.contextual.language_learning";
const base = join(homedir(), "Library", "Application Support");
const manifestPath = join(base, "Google", "Chrome", "NativeMessagingHosts", name + ".json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.name, name);
assert.ok(manifest.allowed_origins.includes("chrome-extension://" + extensionId + "/"));
const bundle = join(base, "Contextual Language Learning", "native-host", "native-host.mjs");
const bundleHash = hash(await readFile(bundle));
assert.equal(bundleHash, hash(await readFile(resolve("apps/local-host/dist/native-host.mjs"))));
const child = spawn(manifest.path, [], { stdio: ["pipe", "pipe", "pipe"] });
let buffer = Buffer.alloc(0);
const pending = new Map();
child.stderr.resume();
const failPending = error => {
  for (const p of pending.values()) p.reject(error);
  pending.clear();
};
child.on("error", failPending);
child.on("exit", () => failPending(new Error("Installed Host exited before replying")));
child.stdout.on("data", chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const size = buffer.readUInt32LE();
    if (buffer.length < 4 + size) return;
    try {
      const message = JSON.parse(buffer.subarray(4, 4 + size));
      buffer = buffer.subarray(4 + size);
      const p = pending.get(message.id);
      if (p) {
        pending.delete(message.id);
        p.resolve(message);
      }
    } catch (error) {
      failPending(error);
      child.kill();
      return;
    }
  }
});
const send = request =>
  new Promise((resolveReply, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Installed Host readback timed out"));
    }, 15000);
    pending.set(id, {
      resolve: message => {
        clearTimeout(timer);
        resolveReply(message);
      },
      reject: error => {
        clearTimeout(timer);
        reject(error);
      },
    });
    const data = Buffer.from(JSON.stringify({ id, ...request })),
      header = Buffer.alloc(4);
    header.writeUInt32LE(data.length);
    child.stdin.write(Buffer.concat([header, data]));
  });
try {
  const health = await send({ type: "health" });
  assert.equal(health.type, "health");
  assert.equal(health.protocolVersion, HOST_PROTOCOL_VERSION);
  const lessons = await send({ type: "listLessons" }),
    jobs = await send({ type: "listJobs" });
  assert.equal(lessons.type, "lessons");
  assert.equal(jobs.type, "jobs");
  const documents = [];
  for (const doc of expected) {
    assert.ok(lessons.lessons.some(l => l.documentId === doc.id));
    const reply = await send({ type: "getDocument", documentId: doc.id });
    assert.equal(reply.type, "result");
    assert.deepEqual(readLearningDocument(reply.document), doc);
    const job = jobs.jobs.find(j => j.id === doc.id);
    assert.ok(job);
    assert.equal(job.status, "completed");
    assert.ok(!job.activity?.length);
    documents.push({
      id: doc.id,
      level: doc.profile.level,
      cues: doc.cues.length,
      scenes: doc.sections.length,
      points: doc.points.length,
    });
  }
  for (const id of accepted.retiredIds ?? []) {
    assert.ok(!lessons.lessons.some(l => l.documentId === id));
    const reply = await send({ type: "getDocument", documentId: id });
    assert.equal(reply.type, "error");
    assert.match(reply.message, /停止支援/);
  }
  const result = {
    checkedAt: new Date().toISOString(),
    extensionId,
    manifestPath,
    launcherPath: manifest.path,
    bundleHash,
    protocolVersion: health.protocolVersion,
    documents,
    retiredIdsRejected: accepted.retiredIds ?? [],
    boundary:
      "Actual installed process over stdio; Chrome connectNative, extension reload and real video playback require separate acceptance.",
  };
  await writeFile(
    resolve(option("output") ?? join(dirname(acceptancePath), "installed-host.json")),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  child.stdin.end();
  child.kill();
}
