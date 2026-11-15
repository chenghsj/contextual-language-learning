import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { z } from "zod";
import { SystemVoiceSchema, SpeechDownloadObservationSchema } from "@contextual/core";

const { values } = parseArgs({
  options: {
    helper: { type: "string" },
    "cancel-voice": { type: "string" },
    "control-voice": { type: "string" },
    output: { type: "string" },
  },
});
if (
  process.platform !== "darwin" ||
  !values.helper ||
  !values["cancel-voice"] ||
  !values["control-voice"] ||
  !values.output
) {
  throw new Error(
    "Use --helper PATH --cancel-voice ID --control-voice ID --output DIRECTORY on macOS. This downloads the selected voices and retains installed assets.",
  );
}
const helper = resolve(values.helper);
const directory = resolve(values.output);
await mkdir(directory, { recursive: true });
const target = { operationId: randomUUID(), voiceId: values["cancel-voice"] };
const control = { operationId: randomUUID(), voiceId: values["control-voice"] };
assert.notEqual(target.voiceId, control.voiceId);
const observationsSchema = z.object({
  speechDownloadObservations: z.array(SpeechDownloadObservationSchema).min(1).max(32),
});
async function invoke(input: object): Promise<unknown> {
  const output = await new Promise<string>((fulfill, reject) => {
    const child = execFile(
      helper,
      [],
      { timeout: 75_000, maxBuffer: 1_000_000 },
      (error, stdout) => {
        if (error) reject(error);
        else fulfill(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify(input));
  });
  const result: unknown = JSON.parse(output);
  await appendFile(
    join(directory, "operations.ndjson"),
    JSON.stringify({ at: new Date().toISOString(), input, result }) + "\n",
  );
  return result;
}
async function observe(input: object) {
  return observationsSchema.parse(await invoke(input)).speechDownloadObservations;
}
const initial = z.array(SystemVoiceSchema).parse(await invoke({ action: "catalog" }));
await writeFile(join(directory, "catalog-before.json"), JSON.stringify(initial, null, 2));
for (const operation of [target, control]) {
  const voice = initial.find(voice => voice.id === operation.voiceId);
  assert.ok(voice, "selected exact catalog voice exists");
  assert.equal(voice.resourceAvailable, false, "test voice has no existing physical resource");
  assert.equal(voice.installed, false, "test voice starts uninstalled");
}
const before = await observe({ action: "inspectSpeechDownloads", operations: [target, control] });
assert.ok(before.every(row => row.subscription === "absent" && !row.shared));
let touched = false;
try {
  touched = true;
  const starts = await Promise.all(
    [target, control].map(async operation => {
      const [row] = await observe({ action: "startSpeechDownload", ...operation });
      assert.equal(row.subscription, "present");
      assert.equal(row.ordering, "settled");
      return row;
    }),
  );
  assert.equal(starts.length, 2);
  const [cancelled] = await observe({ action: "cancelSpeechDownload", ...target });
  assert.equal(cancelled.resource, "absent");
  assert.equal(cancelled.subscription, "absent");
  assert.equal(cancelled.cancelFenced, true);
  assert.equal(cancelled.ordering, "settled");
  assert.equal(cancelled.shared, false);
  const [late] = await observe({ action: "startSpeechDownload", ...target });
  assert.equal(late.cancelFenced, true, "a delayed start is fenced across helper processes");
  assert.equal(late.subscription, "absent");
  const deadline = Date.now() + 180_000;
  let completed = false;
  while (Date.now() < deadline) {
    const rows = await observe({ action: "inspectSpeechDownloads", operations: [target, control] });
    const cancelled = rows.find(row => row.operationId === target.operationId);
    const running = rows.find(row => row.operationId === control.operationId);
    assert.equal(cancelled?.subscription, "absent");
    assert.equal(cancelled?.resource, "absent");
    if (running?.resource === "installed") {
      completed = true;
      break;
    }
    await new Promise(fulfill => setTimeout(fulfill, 5_000));
  }
  assert.equal(completed, true, "the independent control downloads and becomes playable");
  const [repeat] = await observe({ action: "cancelSpeechDownload", ...target });
  assert.equal(repeat.subscription, "absent");
  assert.equal(repeat.ordering, "settled");
  const final = z.array(SystemVoiceSchema).parse(await invoke({ action: "catalog" }));
  for (const voice of initial.filter(voice => voice.resourceAvailable)) {
    assert.ok(
      final.some(row => row.id === voice.id && row.resourceAvailable),
      "pre-existing assets remain installed",
    );
  }
  await writeFile(join(directory, "catalog-after.json"), JSON.stringify(final, null, 2));
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(
      {
        verified: true,
        target,
        control,
        lateStartFenced: true,
        repeatedCancel: true,
        parallelControlInstalled: true,
        existingAssetsRetained: true,
        scope: "actual helper only; extension UI and packaging are separate checks",
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    `Actual Siri helper download/cancel acceptance passed. Evidence at ${directory}\n`,
  );
} finally {
  if (touched) {
    const cleanup = await Promise.allSettled(
      [target, control].map(operation => observe({ action: "cancelSpeechDownload", ...operation })),
    );
    assert.ok(
      cleanup.every(result => result.status === "fulfilled"),
      "test-owned subscriptions are withdrawn; downloaded assets are retained",
    );
  }
}
