import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completedLesson } from "./test-fixtures";
import { createDocumentSync } from "./document-sync";
import { DestinationPublisher, publishSavedJob } from "./publish";
import { backupSavedJob } from "./backup";
import { documentRevision, serializeDocument } from "./document-queue";
import { videoFolder } from "./video-folders";
import { toMarkdown } from "../generation/markdown";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test("failed partial publication repairs both files to latest calibration and rejects external edits", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-sync-publication-"));
  try {
    const { storage, document } = await completedLesson(join(root, "canonical"));
    const exports = join(root, "exports");
    const folder = await videoFolder(exports, document);
    const jsonPath = join(folder, document.id + ".json"),
      mdPath = join(folder, document.id + ".md");
    await assert.rejects(
      publishSavedJob(storage, document.id, {
        publish: async doc => {
          await writeFile(jsonPath, JSON.stringify(doc, null, 2) + "\n");
          throw new Error("Crash before Markdown");
        },
      }),
      /Crash/,
    );
    const publisher = new DestinationPublisher(async () => exports);
    const sync = createDocumentSync(storage, { publisher, backup: async () => "drive://saved" });
    const { document: updated, warning } = await sync.saveCalibration(
      document.id,
      { kind: "cue", id: "cue-1" },
      { startMs: 2100, endMs: 3300 },
    );
    assert.equal(warning, undefined);
    assert.deepEqual(JSON.parse(await readFile(jsonPath, "utf8")), updated);
    assert.equal(await readFile(mdPath, "utf8"), toMarkdown(updated));
    const record = await storage.jobs.getRecord(document.id);
    assert.equal(record?.summary.publication?.revision, documentRevision(updated));
    assert.equal(record?.summary.backup?.revision, documentRevision(updated));
    await writeFile(mdPath, "User-edited Markdown");
    const next = await sync.saveCalibration(
      document.id,
      { kind: "cue", id: "cue-1" },
      { startMs: 2200, endMs: 3400 },
    );
    assert.match(next.warning!, /發布資料夾同步失敗/);
    assert.equal(await readFile(mdPath, "utf8"), "User-edited Markdown");
    assert.equal(
      (await storage.documents.get(document.id))?.playbackOverrides?.["cue-1"].startMs,
      2200,
    );
    assert.equal(
      (await storage.jobs.getRecord(document.id))?.summary.publication?.status,
      "failed",
    );
    await assert.rejects(sync.publish(document.id), /independently/);
    assert.equal(
      (await storage.jobs.getRecord(document.id))?.summary.backup?.status,
      "failed",
      "an older upload cannot remain marked synced after publication fails",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore loads inside the lesson queue and preserves a differing local revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-sync-restore-"));
  try {
    const { storage, document } = await completedLesson(root);
    const sync = createDocumentSync(storage);
    const started = deferred<void>(),
      release = deferred<void>();
    let loads = 0;
    const blocked = serializeDocument(storage, document.id, async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;
    const restore = sync.restore(document.id, async () => {
      loads++;
      return { ...document, source: { ...document.source, title: "Remote change" } };
    });
    const rejected = assert.rejects(restore, /不同版本/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 0);
    release.resolve();
    await blocked;
    await rejected;
    assert.equal((await storage.documents.get(document.id))?.source.title, document.source.title);
    await sync.restore(document.id, async () => document);
    await assert.rejects(
      sync.restore(document.id, async () => ({
        ...document,
        id: "00000000-0000-4000-8000-000000000099",
      })),
      /identity mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an in-flight old backup finishes before calibration uploads a new revision, while other lessons proceed", async () => {
  const root = await mkdtemp(join(tmpdir(), "contextual-sync-backup-"));
  try {
    const { storage, document } = await completedLesson(root);
    const publisher = { publish: async () => "/verified/export.json" };
    await publishSavedJob(storage, document.id, publisher);
    const started = deferred<void>(),
      release = deferred<void>();
    const uploaded: import("@contextual/core").LearningDocument[] = [];
    const backup = async (_account: string, doc: import("@contextual/core").LearningDocument) => {
      uploaded.push(doc);
      if (uploaded.length === 1) {
        started.resolve();
        await release.promise;
      }
      return "drive://" + uploaded.length;
    };
    const first = backupSavedJob(storage, document.id, backup);
    await started.promise;
    const sync = createDocumentSync(storage, { publisher, backup });
    const calibration = sync.saveCalibration(
      document.id,
      { kind: "scene", id: document.sections[0].id },
      { startMs: 500, endMs: 4000 },
    );
    await serializeDocument(storage, "another-document", async () =>
      assert.equal(uploaded.length, 1),
    );
    assert.equal((await storage.documents.get(document.id))?.scenePlaybackOverrides, undefined);
    release.resolve();
    await first;
    const latest = await calibration;
    assert.equal(latest.warning, undefined);
    assert.equal(uploaded.length, 2);
    assert.equal(uploaded[0].scenePlaybackOverrides, undefined);
    assert.equal(uploaded[1].scenePlaybackOverrides?.[document.sections[0].id].startMs, 500);
    assert.equal(
      (await storage.jobs.getRecord(document.id))?.summary.backup?.revision,
      documentRevision(latest.document),
    );
    await sync.deleteHistory(document.id);
    assert.equal((await storage.jobs.getRecord(document.id))?.schemaVersion, 1);
    assert.equal(await storage.jobs.get(document.id), null);
    await sync.saveCalibration(
      document.id,
      { kind: "scene", id: document.sections[0].id },
      { startMs: 500, endMs: 4000 },
    );
    assert.equal(uploaded.length, 2, "a no-op calibration keeps the matching backup revision");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("revision is based on canonical content and rejected queue work releases the next operation", async () => {
  assert.equal(documentRevision({ b: 2, a: 1 }), documentRevision({ a: 1, b: 2 }));
  const root = await mkdtemp(join(tmpdir(), "contextual-sync-release-"));
  try {
    const { storage, document } = await completedLesson(root);
    await assert.rejects(
      serializeDocument(storage, document.id, async () => {
        throw new Error("failed");
      }),
    );
    assert.equal(await serializeDocument(storage, document.id, async () => "next"), "next");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
