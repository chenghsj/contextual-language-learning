import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completedLesson } from "./test-fixtures";
import { createDocumentSync } from "./document-sync";
import { serializeDocument } from "./document-queue";

test("deletion waits for queued document work and rejects an unfinished source job", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-delete-queue-"));
  try {
    const { storage, document } = await completedLesson(root);
    const sync = createDocumentSync(storage);
    let release!: () => void;
    const work = serializeDocument(
      storage,
      document.id,
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    await new Promise(resolve => setImmediate(resolve));
    const deletion = sync.deleteLocal(document.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(await storage.documents.get(document.id));
    release();
    await work;
    await deletion;
    assert.equal(await storage.documents.get(document.id), null);
    await sync.restore(document.id, async () => document);
    await storage.jobs.update(document.id, job => ({
      ...job,
      summary: { ...job.summary, status: "running" },
    }));
    await assert.rejects(sync.deleteLocal(document.id), /Only completed/);
    assert.ok(await storage.documents.get(document.id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
