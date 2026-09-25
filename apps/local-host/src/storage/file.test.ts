import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenerationRequestSchema, createJob } from "@immersive/core";
import { FileJobRepository } from "./file";

test("job records survive repository restarts and invalid IDs cannot traverse directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-store-"));
  try {
    const id = randomUUID();
    const job = createJob(GenerationRequestSchema.parse({
      id, source: { platform: "import", title: "Save test" },
      profile: { targetLanguage: "en", instructionLanguage: "en", level: "B1",
        mode: "guided", maxNewVocabulary: 2, exerciseCount: 1 },
      agent: { provider: "claude", modelId: "" },
      cues: [{ id: "cue-1", startMs: null, endMs: null, originalText: "Hello" }],
    }), 1);
    await new FileJobRepository(root).create(job);
    assert.equal((await new FileJobRepository(root).get(id))?.summary.sourceTitle, "Save test");
    await assert.rejects(new FileJobRepository(root).get("../../secrets"), /Invalid repository ID/);
    await assert.rejects(new FileJobRepository(root).create(job), /already exists/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt checkpoint files fail visibly instead of silently resetting job progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "immersive-store-"));
  try {
    const id = randomUUID();
    const folder = join(root, "jobs");
    await import("node:fs/promises").then(fs => fs.mkdir(folder));
    await writeFile(join(folder, id + ".json"), "{corrupt");
    await assert.rejects(new FileJobRepository(root).get(id), /Cannot load saved job/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
