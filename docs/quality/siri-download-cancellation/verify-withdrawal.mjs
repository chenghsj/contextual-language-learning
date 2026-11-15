import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const base = process.argv[2] ? pathToFileURL(resolve(process.argv[2]) + "/") : import.meta.url;
const read = name => readFile(new URL(name, base), "utf8");
const lines = async name =>
  (await read(name))
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
const rows = await lines("subscription-withdrawal.ndjson");
const start = rows.find(row => row.action === "start");
const withdrawal = rows.find(row => row.action === "withdraw");
const summary = JSON.parse(await read("subscription-withdrawal-summary.json"));
const targetIdentity = "com.apple.speech.synthesis.voice.custom.siri.axel.premium";
assert.equal(start.exitCode, 0);
assert.equal(withdrawal.exitCode, 0);
assert.equal(start.records[0].asset.identifier, targetIdentity);
assert.equal(start.records[0].asset.locallyAvailable, false);
assert.deepEqual(start.records[0].ownSubscriptions, []);
assert.equal(start.records.at(-1).ownSubscriptions[0].name, "Axel");
assert.equal(start.records.at(-1).ownSubscriptions[0].language, "sv-SE");
assert.equal(start.records.at(-1).ownSubscriptions[0].clientId, start.records[0].client);
assert.equal(start.records[0].client, withdrawal.records[0].client);
assert.equal(start.records.at(-1).ownSubscriptions.length, 1);
assert.deepEqual(withdrawal.records.at(-1).ownSubscriptions, []);
const canonical = requests => requests.map(request => JSON.stringify(request)).sort();
assert.deepEqual(
  canonical(withdrawal.records[0].otherSubscriptions),
  canonical(withdrawal.records.at(-1).otherSubscriptions),
);
const observations = rows.filter(row => row.action === "inspect");
assert.ok(observations.at(-1).monotonic - withdrawal.monotonic >= 60);
assert.ok(observations.every(row => row.records[0].ownSubscriptions.length === 0));
assert.ok(observations.every(row => row.records[0].asset.locallyAvailable === false));

const system = await read("subscription-withdrawal-system.log");
const transfer = summary.nativeTransfer;
assert.ok(system.includes(transfer.assetSpecifier));
const jobLines = system.split("\n").filter(line => line.includes(transfer.jobId));
assert.ok(
  jobLines.some(
    line => line.includes(transfer.assetId) && line.includes("Cancel of download was successful"),
  ),
);
assert.ok(
  jobLines.some(line => line.includes(transfer.assetId) && line.includes("MADownloadCancelled")),
);
assert.ok(
  jobLines.some(
    line => line.includes("OperationCanceled(6115)") && line.includes("cancel complete"),
  ),
);
assert.ok(jobLines.every(line => line.startsWith("2026-10-20 19:52:47.")));

const repeated = await lines("repeat-withdrawal.ndjson");
assert.equal(repeated.find(row => row.event === "subscriptionReply").error, null);
assert.deepEqual(repeated.at(-1).ownSubscriptions, []);

const parallel = await lines("parallel-withdrawal.ndjson");
const cancel = parallel.find(row => row.voice === "Axel" && row.action === "withdraw");
assert.equal(cancel.exitCode, 0);
assert.deepEqual(cancel.records.at(-1).ownSubscriptions, []);
assert.deepEqual(
  canonical(cancel.records[0].otherSubscriptions),
  canonical(cancel.records.at(-1).otherSubscriptions),
);
const controlStart = parallel.find(row => row.voice === "Tilde" && row.action === "start");
assert.equal(controlStart.exitCode, 0);
assert.ok(
  cancel.records
    .at(-1)
    .otherSubscriptions.some(
      row =>
        row.clientId === controlStart.records[0].client &&
        row.name === "Tilde" &&
        row.language === "sv-SE",
    ),
);
const control = parallel.filter(row => row.voice === "Tilde" && row.action === "inspect");
assert.equal(control[0].records[0].asset.locallyAvailable, false);
assert.equal(control.at(-1).records[0].asset.locallyAvailable, true);
assert.equal(control.at(-1).records[0].ownSubscriptions.length, 1);
const target = parallel.filter(row => row.voice === "Axel" && row.action === "inspect");
assert.equal(target.at(-1).records[0].asset.locallyAvailable, false);
assert.deepEqual(target.at(-1).records[0].ownSubscriptions, []);
console.log(
  "Evidence verified: scoped subscription withdrawal cancelled the system download; reconnect, repeat, and parallel control observations agree.",
);
