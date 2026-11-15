import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";

const supported = process.platform === "darwin";
const exec = promisify(execFile);
let temporary;
let binary;
before(async () => {
  if (!supported) return;
  temporary = await mkdtemp(join(tmpdir(), "siri-journal-tests-"));
  binary = join(temporary, "journal-test");
  const main = join(temporary, "main.swift");
  await writeFile(
    main,
    `
import Foundation
import Darwin
let args = CommandLine.arguments
let action = args[1]
let directory = URL(fileURLWithPath: args[2])
let operation = SiriDownloadOperation(operationId: args[3], voiceId: args[4])
do {
    if action == "physical" {
        let expected = "ar-SA:neural:male:Samer:premium:24"
        let keys = [expected, "ar-SA:neural:undefined:Samer:undefined:0", "ar-SA:neural:male:Samer:premium:23", "ar-SA:neural:female:Samer:premium:25", "ar-SA:natural:male:Samer:premium:24", "ar-SA:neural:male:Other:premium:24", "ar-SA:neural:male:Samer:enhanced:24"]
        FileHandle.standardOutput.write(try JSONEncoder().encode(keys.map { siriResourceMatches($0, expected) }))
        exit(0)
    }
    if action == "matching" || action == "matching-version" {
        let expected = action == "matching" ? "sv-SE:neural:male:Axel:premium:0" : "en-US:natural:female:en-US-G:premium:5028"
        let values = action == "matching" ? [expected, "sv-SE:neural:undefined:Axel:undefined:0", "sv-SE:neural:female:Axel:premium:0", "sv-SE:natural:undefined:Axel:undefined:0", "sv-SE:neural:undefined:Tilde:undefined:0", "sv-SE:neural:undefined:Axel:undefined:1"] : [expected, "en-US:natural:undefined:en-US-G:undefined:0", "en-US:natural:female:en-US-G:premium:0", "en-US:natural:female:en-US-G:undefined:0", "en-US:natural:undefined:en-US-G:undefined:5029", "en-US:natural:undefined:en-US-F:undefined:0"]
        FileHandle.standardOutput.write(try JSONEncoder().encode(values.map { siriSubscriptionMatches($0, expected) }))
        exit(0)
    }
    let journal = try SiriDownloadJournal(directory: directory)
    if action == "removal" {
        let operations = try journal.operationsForRemoval(voiceIds: [operation.voiceId], assetKeys: ["ar-SA:neural:male:Samer:premium:0"])
        FileHandle.standardOutput.write(try JSONEncoder().encode(operations))
        exit(0)
    }
    try journal.withOperations([operation]) {
        var receipt = try journal.load(operation)
        func event(_ value: String) throws {
            let path = directory.appendingPathComponent("events").path
            let fd = open(path, O_WRONLY | O_APPEND | O_CREAT, 0o600)
            guard fd >= 0 else { throw SiriDownloadError("Event write failed") }
            defer { close(fd) }
            let bytes = Array((value + "\\n").utf8)
            guard write(fd, bytes, bytes.count) == bytes.count else { throw SiriDownloadError("Event write failed") }
        }
        if action == "start" || action == "slow-start" || action == "crash-start" || action == "ack-failure" {
            if try journal.enterStart(&receipt) {
                try event("entered")
                if action == "crash-start" { Thread.sleep(forTimeInterval: 60) }
                if action == "slow-start" { Thread.sleep(forTimeInterval: 0.4) }
                try event("subscribe")
                if action == "ack-failure" {
                    chmod(directory.path, 0o500)
                    defer { chmod(directory.path, 0o700) }
                    try journal.acknowledgeStart(&receipt)
                } else { try journal.acknowledgeStart(&receipt) }
            }
        } else if action == "cancel" {
            try journal.fenceCancel(&receipt)
            try event("withdraw")
        } else if action == "save-failure" {
            chmod(directory.path, 0o500)
            defer { chmod(directory.path, 0o700) }
            if try journal.enterStart(&receipt) { try event("subscribe") }
        }
        if action == "ordering" { FileHandle.standardOutput.write(try JSONEncoder().encode(receipt.ordering)) }
        else { FileHandle.standardOutput.write(try JSONEncoder().encode(receipt)) }
    }
} catch {
    fputs(error.localizedDescription + "\\n", stderr)
    exit(1)
}
`,
  );
  await exec(
    "/usr/bin/xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      "-module-cache-path",
      join(temporary, "modules"),
      fileURLToPath(new URL("../src/platform/siri/SiriDownloadJournal.swift", import.meta.url)),
      main,
      "-o",
      binary,
    ],
    { timeout: 120_000 },
  );
});
after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
const voice = "siri:com.apple.tts.test.voice";
test(
  "Siri subscription readback preserves exact target identity when gender and footprint are omitted",
  { skip: !supported },
  async () => {
    assert.deepEqual(await run("matching", await fixture()), [
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  },
);
test(
  "daemon canonical readback can omit a catalog version without accepting explicit identity changes",
  { skip: !supported },
  async () => {
    assert.deepEqual(await run("matching-version", await fixture()), [
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  },
);
test(
  "an operation never seen by the helper remains uncertain until cancellation fences it",
  { skip: !supported },
  async () => {
    const operation = await fixture();
    assert.equal(await run("ordering", operation), "unconfirmed");
    await run("cancel", operation);
    assert.equal(await run("ordering", operation), "settled");
  },
);
async function fixture() {
  return {
    directory: await mkdtemp(join(temporary, "state-")),
    id: randomUUID(),
  };
}
async function run(action, fixture, voiceId = voice) {
  const result = await exec(binary, [action, fixture.directory, fixture.id, voiceId]);
  return JSON.parse(result.stdout);
}
async function events(fixture) {
  return readFile(join(fixture.directory, "events"), "utf8").catch(() => "");
}
async function waitEntered(fixture) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await events(fixture)).includes("entered")) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Start never entered");
}
test(
  "cancel before any start persists a permanent fence across processes",
  { skip: !supported },
  async () => {
    const fixtureValue = await fixture();
    const cancelled = await run("cancel", fixtureValue);
    assert.equal(cancelled.cancelFenced, true);
    const restarted = await run("start", fixtureValue);
    assert.equal(restarted.startEntered, false);
    assert.equal(restarted.cancelFenced, true);
    assert.equal(await run("ordering", fixtureValue), "settled");
    assert.equal(await events(fixtureValue), "withdraw\n");
  },
);
test(
  "flock orders concurrent start and cancellation, including uppercase UUID aliases",
  { skip: !supported },
  async () => {
    const fixtureValue = await fixture();
    const start = run("slow-start", fixtureValue);
    await waitEntered(fixtureValue);
    const cancel = run("cancel", {
      ...fixtureValue,
      id: fixtureValue.id.toUpperCase(),
    });
    await start;
    const receipt = await cancel;
    assert.equal(receipt.startAcknowledged, true);
    assert.equal(receipt.cancelFenced, true);
    await run("start", fixtureValue);
    assert.equal(await events(fixtureValue), "entered\nsubscribe\nwithdraw\n");
  },
);
test(
  "a killed start remains unacknowledged after withdrawal and restart",
  { skip: !supported },
  async () => {
    const fixtureValue = await fixture();
    const child = spawn(binary, ["crash-start", fixtureValue.directory, fixtureValue.id, voice]);
    const closed = new Promise(resolve => child.once("close", resolve));
    await waitEntered(fixtureValue);
    child.kill("SIGKILL");
    await closed;
    const cancelled = await run("cancel", fixtureValue);
    assert.equal(cancelled.startEntered, true);
    assert.equal(cancelled.startAcknowledged, false);
    assert.equal(cancelled.cancelFenced, true);
    const restarted = await run("start", fixtureValue);
    assert.equal(restarted.startAcknowledged, false);
    assert.equal(await run("ordering", fixtureValue), "unconfirmed");
    assert.equal(await events(fixtureValue), "entered\nwithdraw\n");
  },
);
test(
  "an operation cannot be rebound to another voice or a path",
  { skip: !supported },
  async () => {
    const fixtureValue = await fixture();
    await run("cancel", fixtureValue);
    await assert.rejects(run("start", fixtureValue, "siri:other"), /identity does not match/);
    await assert.rejects(
      run("start", { ...fixtureValue, id: "../escape" }),
      /Invalid Siri download identity/,
    );
    assert.equal(await events(fixtureValue), "withdraw\n");
  },
);
test(
  "failed receipt persistence prevents subscribe, failed acknowledgement remains ambiguous",
  { skip: !supported },
  async () => {
    const fixtureValue = await fixture();
    await assert.rejects(run("save-failure", fixtureValue), /journal|receipt/);
    assert.equal(await events(fixtureValue), "");
    const absent = await run("inspect", fixtureValue);
    assert.equal(absent.startEntered, false);
    await assert.rejects(run("ack-failure", fixtureValue), /journal|receipt/);
    const entered = await run("inspect", fixtureValue);
    assert.equal(entered.startEntered, true);
    assert.equal(entered.startAcknowledged, false);
    assert.equal(await run("ordering", fixtureValue), "unconfirmed");
    await run("start", fixtureValue);
    assert.equal(await events(fixtureValue), "entered\nsubscribe\n");
  },
);
test(
  "corrupt, public, and symlink receipts fail closed before effects",
  { skip: !supported },
  async () => {
    const fixtureValue = await fixture();
    const receiptPath = join(fixtureValue.directory, fixtureValue.id + ".json");
    await writeFile(receiptPath, "{broken", { mode: 0o600 });
    await assert.rejects(run("start", fixtureValue));
    await chmod(receiptPath, 0o644);
    await assert.rejects(run("cancel", fixtureValue), /not private/);
    await rm(receiptPath);
    await symlink(join(temporary, "missing.json"), receiptPath);
    await assert.rejects(run("start", fixtureValue), /journal/);
    assert.equal(await events(fixtureValue), "");
  },
);

test(
  "resource removal selects persisted requests for the physical voice without touching unrelated operations",
  { skip: !supported },
  async () => {
    const state = await fixture();
    const receipt = (operationId, voiceId, assetKey) => ({
      version: 1,
      operationId,
      voiceId,
      startEntered: true,
      startAcknowledged: true,
      cancelFenced: false,
      assetKey,
    });
    const own = receipt(state.id, voice, "ar-SA:neural:male:Samer:premium:0");
    const alias = receipt(randomUUID(), "siri:old-alias", "ar-SA:neural:male:Samer:premium:23");
    const unrelated = receipt(randomUUID(), "siri:nora", "en-US:natural:female:Nora:premium:0");
    for (const value of [own, alias, unrelated])
      await writeFile(join(state.directory, value.operationId + ".json"), JSON.stringify(value), {
        mode: 0o600,
      });
    assert.deepEqual(
      (await run("removal", state)).map(item => item.operationId).sort(),
      [own.operationId, alias.operationId].sort(),
    );
    assert.equal(
      JSON.parse(await readFile(join(state.directory, unrelated.operationId + ".json")))
        .cancelFenced,
      false,
    );
    const corruptIdentity = { ...own, operationId: randomUUID() };
    await writeFile(
      join(state.directory, own.operationId + ".json"),
      JSON.stringify(corruptIdentity),
      { mode: 0o600 },
    );
    await assert.rejects(run("removal", state), /identity/);
  },
);

test(
  "physical removal detects retained requests across content versions while retaining resource identity",
  { skip: !supported },
  async () => {
    assert.deepEqual(await run("physical", await fixture()), [
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  },
);
