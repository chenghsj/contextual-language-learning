import test from "node:test";
import assert from "node:assert/strict";
import { SiriSpeechBackend } from "./siri-speech";
import { SystemSpeechService } from "./speech";
import { createSpeechHandler } from "../host/speech";
import {
  HostRequestSchema,
  HostMessageSchema,
  SpeechDownloadOperationSchema,
  type SpeechDownloadObservation,
} from "@contextual/core";

const operation = SpeechDownloadOperationSchema.parse({
  operationId: "01234567-89ab-4cde-8f01-23456789abcd",
  voiceId: "siri:voice-one",
});
const second = SpeechDownloadOperationSchema.parse({
  operationId: "11234567-89ab-4cde-8f01-23456789abcd",
  voiceId: "siri:voice-two",
});
const observation = (value = operation): SpeechDownloadObservation => ({
  ...value,
  resource: "absent",
  subscription: "present",
  ordering: "settled",
  cancelFenced: false,
  shared: false,
});

test("Host downloads send exact operation identities and use one native batch inspection", async () => {
  const actions: unknown[] = [];
  const backend = new SiriSpeechBackend(
    (_command, _args, input, timeout) => {
      const request = JSON.parse(input!);
      actions.push(request);
      assert.equal(timeout, 60_000);
      const operations =
        request.action === "inspectSpeechDownloads" ? request.operations : [request];
      return {
        stop() {},
        completion: Promise.resolve(
          JSON.stringify({
            speechDownloadObservations: operations.map((value: typeof operation) =>
              observation(value),
            ),
          }),
        ),
      };
    },
    process.execPath,
    () => true,
  );
  const service = new SystemSpeechService("darwin", undefined, undefined, undefined, backend);
  const replies: unknown[] = [];
  const handler = createSpeechHandler(
    reply => replies.push(HostMessageSchema.parse(reply)),
    service,
  );
  for (const type of ["startSpeechDownload", "cancelSpeechDownload"] as const) {
    assert.equal(
      await handler.handle(
        HostRequestSchema.parse({
          id: crypto.randomUUID(),
          type,
          ...operation,
        }),
      ),
      true,
    );
  }
  await handler.handle(
    HostRequestSchema.parse({
      id: crypto.randomUUID(),
      type: "inspectSpeechDownloads",
      operations: [operation, second],
    }),
  );
  assert.deepEqual(actions, [
    { action: "startSpeechDownload", ...operation },
    { action: "cancelSpeechDownload", ...operation },
    { action: "inspectSpeechDownloads", operations: [operation, second] },
  ]);
  assert.equal(replies.length, 3);
  handler.close();
  await assert.rejects(service.startDownload(operation), /closed/);
});

test("adapter rejects missing, duplicated, mismatched and malformed observations", async () => {
  let observations: unknown[] = [observation()];
  const backend = new SiriSpeechBackend(
    () => ({
      stop() {},
      completion: Promise.resolve(JSON.stringify({ speechDownloadObservations: observations })),
    }),
    process.execPath,
    () => true,
  );
  await assert.rejects(backend.inspectDownloads([operation, operation]), /Duplicate/);
  for (const invalid of [
    [],
    [observation(), observation()],
    [observation(second)],
    [{ ...observation(), voiceId: second.voiceId }],
    [{ ...observation(), ordering: "probably" }],
  ]) {
    observations = invalid;
    await assert.rejects(backend.startDownload(operation));
  }
  observations = [observation(second), observation()];
  await assert.rejects(backend.inspectDownloads([operation, second]), /identity/);
});

test("adapter preserves ambiguous cancellation and shared-resource evidence", async () => {
  const expected = {
    ...observation(),
    subscription: "absent",
    ordering: "unconfirmed",
    cancelFenced: true,
    shared: true,
  };
  const backend = new SiriSpeechBackend(
    () => ({
      stop() {},
      completion: Promise.resolve(JSON.stringify({ speechDownloadObservations: [expected] })),
    }),
    process.execPath,
    () => true,
  );
  assert.deepEqual(await backend.cancelDownload(operation), [expected]);
});

test("simultaneous catalog readers coalesce and subsequent reads refresh", async () => {
  let calls = 0;
  let finish: ((value: string) => void) | undefined;
  const backend = new SiriSpeechBackend(
    () => {
      calls++;
      return {
        stop() {},
        completion: new Promise<string>(resolve => {
          finish = resolve;
        }),
      };
    },
    process.execPath,
    () => true,
  );
  const first = backend.catalog();
  const secondRead = backend.catalog();
  assert.equal(first, secondRead);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish("[]");
  await first;
  assert.equal(calls, 1);
  finish = undefined;
  const refresh = backend.catalog();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const resolveRefresh: (value: string) => void = finish;
  resolveRefresh("[]");
  await refresh;
  assert.equal(calls, 2);
});
