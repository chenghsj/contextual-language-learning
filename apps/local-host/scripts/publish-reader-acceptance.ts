/** Save only individually accepted fixed short samples to the actual local library. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import assert from "node:assert/strict";
import {
  currentLearningExecution,
  readLearningDocument,
  learningDocumentToMarkdown,
} from "@contextual/core";
import { localStoragePorts } from "../src/storage/file";
import { defaultDocumentsFolder } from "../src/platform/paths";
const acceptancePath = process.argv.find(a => a.startsWith("--acceptance="))?.slice(13);
if (!acceptancePath) throw new Error("--acceptance=<acceptance.json> is required");
const acceptance = JSON.parse(await readFile(resolve(acceptancePath), "utf8"));
assert.equal(acceptance.cases.length, 4);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const before = JSON.parse(
  await readFile(join(dirname(acceptancePath), "local-before.json"), "utf8"),
);
async function assertPriorFilesUnchanged() {
  for (const file of before.files)
    assert.equal(hash(await readFile(file.path)), file.sha256, "Pre-existing library file changed");
}
await assertPriorFilesUnchanged();
const product = localStoragePorts(join(defaultDocumentsFolder(), "data-v7"));
const prepared = [];
for (const entry of acceptance.cases) {
  assert.equal(entry.structural, "passed");
  assert.equal(entry.semantic, "passed");
  const docPath = resolve(dirname(acceptancePath), entry.documentPath),
    bytes = await readFile(docPath);
  assert.equal(hash(bytes), entry.documentHash);
  const doc = readLearningDocument(JSON.parse(bytes.toString("utf8")));
  assert.equal(doc.id, entry.id);
  assert.ok(currentLearningExecution(doc.execution));
  assert.equal(doc.profile.level, entry.level);
  assert.equal(doc.generation.provider, "antigravity");
  assert.equal(doc.generation.modelId, "gemini-3.8-flash");
  const draft = localStoragePorts(resolve(dirname(acceptancePath), entry.storagePath));
  const job = await draft.jobs.get(doc.id);
  assert.ok(job);
  assert.equal(job.summary.status, "completed");
  assert.ok(!job.request.backup?.enabled);
  assert.deepEqual(doc.cues, job.request.cues);
  assert.equal(doc.profile.instructionLanguage, "zh-TW");
  const existing = await product.documents.get(doc.id),
    prior = await product.jobs.get(doc.id);
  if (existing) assert.deepEqual(existing, doc);
  if (prior) assert.deepEqual(prior, job);
  prepared.push({ doc, job, existing, prior });
}
for (const { doc, job, existing, prior } of prepared) {
  if (!existing) await product.documents.save(doc, learningDocumentToMarkdown(doc));
  if (!prior) await product.jobs.create(job);
  assert.deepEqual(await product.documents.get(doc.id), doc);
}
await assertPriorFilesUnchanged();
const result = {
  checkedAt: new Date().toISOString(),
  target: "local data-v7",
  driveBackup: false,
  acceptedIds: prepared.map(p => p.doc.id),
  preExistingFileHashesUnchanged: before.files.length,
};
await writeFile(join(dirname(acceptancePath), "publication.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
