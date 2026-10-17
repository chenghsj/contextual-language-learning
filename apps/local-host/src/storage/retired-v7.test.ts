import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { localStoragePorts } from "./file";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
test("V5/V6 malformed files are skipped before parsing; direct IDs retire, all file hashes unchanged", async () => {
  const parent = await mkdtemp(join(tmpdir(), "cll-retired-v7-")),
    root = join(parent, "data-v7");
  const ports = localStoragePorts(root);
  const before = new Map<string, string>();
  try {
    for (const version of [5, 6]) {
      const id = randomUUID(),
        folder = join(parent, "data-v" + version, "videos", "old");
      await mkdir(folder, { recursive: true });
      const path = join(folder, id + ".json"),
        text = JSON.stringify({
          id,
          schemaVersion: version,
          execution: { promptVersion: "retired" },
          sections: "damaged old data",
        });
      await writeFile(path, text);
      before.set(path, hash(text));
      await assert.rejects(ports.documents.get(id), /停止支援/);
      const jobs = join(parent, "data-v" + version, "jobs");
      await mkdir(jobs, { recursive: true });
      const jp = join(jobs, id + ".json");
      await writeFile(jp, text);
      before.set(jp, hash(text));
      await assert.rejects(ports.jobs.get(id), /停止支援/);
    }
    const f = pointsFixture();
    await ports.documents.save(f.document, "");
    const invalidId = randomUUID(),
      path = join(root, "videos", "bad");
    await mkdir(path, { recursive: true });
    const bad = JSON.stringify({
      id: invalidId,
      schemaVersion: 6,
      execution: { promptVersion: "retired" },
      sections: "not an array",
    });
    await writeFile(join(path, invalidId + ".json"), bad);
    before.set(join(path, invalidId + ".json"), hash(bad));
    assert.deepEqual(
      (await ports.documents.list()).map(d => d.id),
      [f.document.id],
    );
    assert.deepEqual(await ports.jobs.list(), []);
    await assert.rejects(ports.documents.get(invalidId), /停止支援/);
    for (const [file, digest] of before) assert.equal(hash(await readFile(file, "utf8")), digest);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
