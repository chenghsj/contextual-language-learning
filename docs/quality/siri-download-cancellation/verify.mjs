import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(name, import.meta.url), "utf8");
const events = (await read("hiro-cancellation.ndjson"))
  .trim()
  .split("\n")
  .map(line => JSON.parse(line));
const start = events.find(event => event.event === "installHelperExited");
assert.equal(start?.exitCode, 0);
assert.equal(JSON.parse(start.stdout).status, "requested");
const cancel = events.find(event => event.event === "probe" && event.action === "cancel");
assert.equal(cancel?.exitCode, 0);
const reply = cancel.records.find(record => record.event === "cancelReply");
assert.equal(reply?.callback, true);
assert.equal(reply.asset.locallyAvailable, false);
const completion = events.find(
  event =>
    event.event === "probe" &&
    event.action === "status" &&
    event.records.some(record => record.asset?.locallyAvailable === true),
);
assert.ok(completion && completion.monotonic > cancel.monotonic);

const progress = await read("hiro-system-progress.log");
const samples = [
  ...progress.matchAll(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})[^\n]*reportPercent[^\n]*\n([\s\S]*?)\}: (\d+) percent \((\d+) \/ (\d+)\) \. Status: (\w+)/gm,
  ),
].map(match => ({
  time: Date.parse(`${match[1]}T${match[2]}+08:00`),
  voice: match[3],
  bytes: Number(match[5]),
  total: Number(match[6]),
  status: match[7],
}));
const cancelledAt = Date.parse(reply.timestamp);
const continued = samples.filter(
  sample =>
    sample.time > cancelledAt &&
    sample.voice.includes("com.apple.siri.tts.voice.ja_JP.hiro.neural.premium"),
);
assert.ok(continued.some(sample => sample.status === "downloading" && sample.bytes > 0));
assert.ok(
  continued.some(
    sample => sample.status === "complete" && sample.bytes === sample.total && sample.total > 0,
  ),
);

const before = JSON.parse(await read("installed-voices-before.json"));
const after = JSON.parse(await read("installed-voices-after.json"));
const afterIds = new Set(after.map(voice => voice.id));
assert.deepEqual(
  before.filter(voice => !afterIds.has(voice.id)),
  [],
);
const added = after.filter(voice => !before.some(previous => previous.id === voice.id));
assert.deepEqual(added.map(voice => voice.name).sort(), ["Hattori", "Hiro"]);
const summary = JSON.parse(await read("summary.json"));
assert.equal(summary.cancellationGate, "NOT VERIFIED");
console.log(
  "Evidence verified: the initial asset-cancel candidate did not stop the download; that candidate remains NOT VERIFIED.",
);
