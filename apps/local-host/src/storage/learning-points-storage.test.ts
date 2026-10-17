import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { completedLesson } from "./test-fixtures";
import { createDocumentSync } from "./document-sync";
test("current calibration round trips source without regenerating or overwriting", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-calibration-"));
  try {
    const { storage, document } = await completedLesson(root);
    const { document: updated } = await createDocumentSync(storage).saveCalibration(
      document.id,
      { kind: "cue", id: "cue-2" },
      { startMs: 2100, endMs: 4100 },
    );
    assert.deepEqual(updated.cues, document.cues);
    assert.deepEqual(await storage.documents.get(document.id), JSON.parse(JSON.stringify(updated)));
    await assert.rejects(storage.documents.save(document, ""), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
