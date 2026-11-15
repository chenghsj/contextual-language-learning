/** Synthetic small fixtures in a temporary directory; never reads the user library or calls AI. */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pointsFixture } from "../../../packages/core/test/learning-points-fixture";
import { createSceneJob } from "@contextual/core";
import { localStoragePorts } from "../src/storage/file";
const root = await mkdtemp(join(tmpdir(), "cll-list-benchmark-"));
const rows = [];
try {
  const f = pointsFixture();
  const job = createSceneJob(f.request, 1);
  job.execution = f.document.execution;
  const snapshot = JSON.stringify(job);
  const document = JSON.stringify(f.document);
  for (const count of [10, 50, 100]) {
    const dir = join(root, String(count));
    await mkdir(join(dir, "jobs"), { recursive: true });
    for (let i = 0; i < count; i++) {
      const id = randomUUID(),
        folder = join(dir, "videos", "fixture-" + i);
      await mkdir(folder, { recursive: true });
      const next = JSON.parse(document);
      next.id = id;
      await writeFile(join(folder, id + ".json"), JSON.stringify(next));
      const nextJob = JSON.parse(snapshot);
      nextJob.summary.id = id;
      nextJob.request.id = id;
      await writeFile(join(dir, "jobs", id + ".json"), JSON.stringify(nextJob));
    }
    const storage = localStoragePorts(dir);
    for (const [kind, read] of [
      ["jobs", () => storage.jobs.list(50)],
      ["documents", () => storage.documents.list(50)],
    ] as const) {
      const timings = [];
      for (let round = 0; round < 3; round++) {
        const start = performance.now();
        const result = await read();
        if (result.length !== Math.min(count, 50)) throw new Error("Unexpected result count");
        timings.push(Math.round((performance.now() - start) * 10) / 10);
      }
      rows.push({
        count,
        kind,
        limit: 50,
        elapsedMs: timings,
        fixtureBytes: kind === "jobs" ? Buffer.byteLength(snapshot) : Buffer.byteLength(document),
      });
    }
  }
  process.stdout.write(
    JSON.stringify({ synthetic: true, layout: "one document per video folder", rows }, null, 2) +
      "\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
