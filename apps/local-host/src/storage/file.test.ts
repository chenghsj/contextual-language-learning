import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { completedLesson } from "./test-fixtures";
import { localStoragePorts } from "./file";
import { findLocalDuplicates } from "../duplicates";
import { JobManager } from "../jobs/manager";
import { findVideoDocument } from "./video-folders";

test("current storage skips retired envelopes, preserves files and rejects direct access", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-current-storage-"));
  try {
    const { storage, document } = await completedLesson(root);
    const id = randomUUID();
    const folder = join(root, "videos", "retired");
    await mkdir(folder, { recursive: true });
    const old = {
      ...document,
      id,
      execution: { ...document.execution!, promptVersion: "learning-points-prompts-11" },
    };
    await assert.rejects(storage.documents.save(old, "retired"), /停止支援/);
    const text = JSON.stringify(old);
    await writeFile(join(folder, id + ".json"), text);
    const oldJob = { schemaVersion: 5, execution: old.execution, summary: { id } };
    await writeFile(join(root, "jobs", id + ".json"), JSON.stringify(oldJob));
    assert.deepEqual(
      (await storage.documents.list()).map(d => d.id),
      [document.id],
    );
    assert.deepEqual(
      (await storage.jobs.list()).map(j => j.id),
      [document.id],
    );
    await assert.rejects(storage.documents.get(id), /停止支援/);
    await assert.rejects(storage.jobs.get(id), /停止支援/);
    assert.equal(await readFile(join(folder, id + ".json"), "utf8"), text);
    assert.equal(await readFile(join(root, "jobs", id + ".json"), "utf8"), JSON.stringify(oldJob));
    const request = (await storage.jobs.get(document.id))!.request;
    assert.equal((await findLocalDuplicates(request, storage)).length, 1);
    const restarted = localStoragePorts(root);
    assert.deepEqual(
      await restarted.documents.get(document.id),
      JSON.parse(JSON.stringify(document)),
    );
    await assert.rejects(restarted.documents.get("../bad"), /Invalid/);
    await storage.documents.updatePlaybackRange(document.id, "cue-1", {
      startMs: 100,
      endMs: 2100,
    });
    assert.equal(
      (await storage.documents.get(document.id))!.cues[0].startMs,
      document.cues[0].startMs,
    );
    await storage.jobs.deleteHistory(document.id);
    assert.deepEqual(await restarted.jobs.list(), []);
    assert.equal((await restarted.jobs.getRecord(document.id))!.summary.documentId, document.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("corrupt current checkpoints fail visibly instead of resetting", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-current-corrupt-"));
  try {
    const { storage, document } = await completedLesson(root);
    await writeFile(join(root, "jobs", document.id + ".json"), "{");
    await assert.rejects(storage.jobs.list(), /Cannot load/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retired V5 IDs are identified without parsing or modifying their files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-retired-id-"));
  try {
    const id = randomUUID(),
      retired = join(root, "data-v5");
    await mkdir(join(retired, "jobs"), { recursive: true });
    await mkdir(join(retired, "videos", "old"), { recursive: true });
    const paths = [
      join(retired, "jobs", id + ".json"),
      join(retired, "videos", "old", id + ".json"),
    ];
    for (const path of paths) await writeFile(path, "unparseable retired file");
    const storage = localStoragePorts(join(root, "data-v7"));
    assert.deepEqual(await storage.documents.list(), []);
    assert.deepEqual(await storage.jobs.list(), []);
    await assert.rejects(storage.documents.get(id), /停止支援/);
    await assert.rejects(storage.jobs.get(id), /停止支援/);
    for (const path of paths)
      assert.equal(await readFile(path, "utf8"), "unparseable retired file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compatible completed V7 lessons remain readable across prompt changes without rewriting files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-readable-v7-"));
  try {
    const { storage, document } = await completedLesson(root);
    for (const promptVersion of [
      "learning-points-prompts-12",
      "learning-points-prompts-13",
      "learning-points-prompts-17",
      "learning-points-prompts-18",
      "learning-points-prompts-19",
    ]) {
      const id = randomUUID(),
        folder = join(root, "videos", promptVersion);
      const old = {
        ...document,
        id,
        execution: {
          ...document.execution!,
          promptVersion,
          qualityStrategyVersion:
            promptVersion === "learning-points-prompts-19"
              ? "program-validation-3"
              : ["learning-points-prompts-17", "learning-points-prompts-18"].includes(promptVersion)
                ? "program-validation-2"
                : "learning-quality-1",
          languageStrategyVersion: [
            "learning-points-prompts-18",
            "learning-points-prompts-19",
          ].includes(promptVersion)
            ? "learning-language-strategies-5"
            : "learning-language-strategies-4",
        },
      };
      const text = JSON.stringify(old);
      await mkdir(folder, { recursive: true });
      const path = join(folder, id + ".json");
      await writeFile(path, text);
      assert.deepEqual(await storage.documents.get(id), JSON.parse(text));
      assert.ok((await storage.documents.list()).some(d => d.id === id));
      assert.equal(await readFile(path, "utf8"), text);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy resume after canonical save finalizes the existing lesson without relabelling or overwriting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-saved-resume-"));
  try {
    const { storage, document } = await completedLesson(root);
    const savedJob = (await storage.jobs.get(document.id))!;
    const old = {
      ...document,
      execution: {
        ...document.execution!,
        inputFingerprint: createHash("sha256")
          .update(JSON.stringify(savedJob.request))
          .digest("hex"),
        promptVersion: "learning-points-prompts-13",
        qualityStrategyVersion: "learning-quality-1",
        languageStrategyVersion: "learning-language-strategies-4",
      },
    };
    const path = (await findVideoDocument(root, document.id))!;
    const text = JSON.stringify(old);
    await writeFile(path, text);
    await storage.jobs.update(document.id, j => ({
      ...j,
      execution: old.execution,
      summary: { ...j.summary, status: "failed", documentId: undefined, execution: old.execution },
    }));
    let calls = 0;
    const manager = new JobManager(
      {
        storage,
        generateSection: async () => {
          calls++;
          throw new Error("must reuse saved document");
        },
      },
      () => {},
    );
    const resumed = await manager.resume(document.id, document.id);
    assert.deepEqual(resumed, JSON.parse(text));
    assert.equal(calls, 0);
    assert.equal((await storage.jobs.get(document.id))!.summary.status, "completed");
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listing discovered document paths preserves ordering, limits and corrupt-file errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-list-paths-"));
  try {
    const { storage, document } = await completedLesson(root);
    const newer = { ...document, id: randomUUID(), createdAt: "2026-10-17T00:00:00.000Z" };
    const folder = join(root, "videos", "another-source");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, newer.id + ".json"), JSON.stringify(newer));
    assert.deepEqual(
      (await storage.documents.list(1)).map(doc => doc.id),
      [newer.id],
    );
    assert.deepEqual(
      (await storage.documents.list()).map(doc => doc.id),
      [newer.id, document.id],
    );
    assert.deepEqual(await storage.documents.get(newer.id), JSON.parse(JSON.stringify(newer)));
    const brokenId = randomUUID();
    await writeFile(join(folder, brokenId + ".json"), "{");
    await assert.rejects(storage.documents.list(), /Cannot load document/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listing and direct reads both reject duplicate IDs across video folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-list-duplicates-"));
  try {
    const { storage, document } = await completedLesson(root);
    const original = (await findVideoDocument(root, document.id))!;
    const bytes = await readFile(original, "utf8");
    const duplicateFolder = join(root, "videos", "duplicate");
    await mkdir(duplicateFolder, { recursive: true });
    const duplicate = join(duplicateFolder, document.id + ".json");
    await writeFile(duplicate, bytes);
    await assert.rejects(storage.documents.list(), /Document exists in multiple video folders/);
    await assert.rejects(
      storage.documents.get(document.id),
      /Document exists in multiple video folders/,
    );
    assert.equal(await readFile(original, "utf8"), bytes);
    assert.equal(await readFile(duplicate, "utf8"), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
