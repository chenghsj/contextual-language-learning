import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const source = fileURLToPath(new URL(".", import.meta.url));
const verifier = fileURLToPath(new URL("verify-withdrawal.mjs", import.meta.url));
const cases = [
  [
    "missing native cancellation",
    "subscription-withdrawal-system.log",
    text => text.replaceAll("MADownloadCancelled", "OtherResult"),
  ],
  [
    "unrelated cancellation job",
    "subscription-withdrawal-system.log",
    text => text.replaceAll("B67C4291-49FD-4DAA-9ED3-7E60A5387EE3", "UNRELATED-JOB"),
  ],
  [
    "parallel peer removed",
    "parallel-withdrawal.ndjson",
    text =>
      text
        .split("\n")
        .map(line => {
          if (!line.trim()) return line;
          const row = JSON.parse(line);
          if (row.voice === "Axel" && row.action === "withdraw")
            row.records.at(-1).otherSubscriptions = [];
          return JSON.stringify(row);
        })
        .join("\n"),
  ],
  [
    "control never completes",
    "parallel-withdrawal.ndjson",
    text => text.replaceAll('"locallyAvailable": true', '"locallyAvailable": false'),
  ],
];

for (const [name, filename, damage] of cases) {
  test(`withdrawal evidence gate rejects ${name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "cll-withdrawal-evidence-"));
    try {
      await cp(source, directory, { recursive: true });
      const target = join(directory, filename);
      await writeFile(target, damage(await readFile(target, "utf8")));
      const result = spawnSync(process.execPath, [verifier, directory], { encoding: "utf8" });
      assert.notEqual(result.status, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
