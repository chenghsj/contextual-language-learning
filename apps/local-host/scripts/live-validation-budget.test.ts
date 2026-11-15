import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveValidationTask } from "./live-validation-budget";

test("parallel validation work cannot exceed the authorized count, including a retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-validation-budget-"));
  const file = join(root, "budget.json");
  try {
    await writeFile(file, JSON.stringify({ authorizedModelTasks: 2, reservations: [] }));
    const outcomes = await Promise.allSettled([
      reserveValidationTask(file, "scene-1"),
      reserveValidationTask(file, "scene-2"),
      reserveValidationTask(file, "retry"),
    ]);
    assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 2);
    assert.equal(outcomes.filter(r => r.status === "rejected").length, 1);
    assert.equal(JSON.parse(await readFile(file, "utf8")).reservations.length, 2);
    await assert.rejects(reserveValidationTask(file, "after restart"), /exhausted/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
