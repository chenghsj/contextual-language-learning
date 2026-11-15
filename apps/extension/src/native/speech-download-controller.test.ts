import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  SpeechDownloadIdSchema,
  type HostMessage,
  type HostRequest,
  type SpeechDownloadObservation,
} from "@contextual/core";
import {
  SpeechDownloadController,
  SPEECH_DOWNLOAD_STORAGE_KEY,
} from "./speech-download-controller";
import type { BackgroundHostGateway } from "./generation-controller";

const voice = {
  id: "siri.en.test",
  name: "Test Siri",
  language: "en-US",
  engine: "siri" as const,
  installed: false,
  resourceId: "test-resource",
};
const settle = (
  request: Extract<HostRequest, { type: "startSpeechDownload" | "cancelSpeechDownload" }>,
  changes: Partial<SpeechDownloadObservation> = {},
): HostMessage => ({
  id: request.id,
  type: "speechDownloadObservations",
  observations: [
    {
      operationId: request.operationId,
      voiceId: request.voiceId,
      resource: "absent",
      subscription: "present",
      ordering: "settled",
      cancelFenced: false,
      shared: false,
      ...changes,
    },
  ],
});
function harness(saved?: unknown) {
  let stored = saved;
  let failWrites = false;
  let retained = 0;
  const requests: HostRequest[] = [];
  let startResolve: ((value: HostMessage) => void) | undefined;
  let blockStart = false;
  let inspectFailures = 0;
  let writes = 0;
  let blockMarker = false;
  let releaseMarker: (() => void) | undefined;
  const gateway: BackgroundHostGateway = {
    retain() {
      retained++;
      return () => {
        retained--;
      };
    },
    async request(request) {
      requests.push(request);
      if (request.type === "listSpeechVoiceCatalog")
        return {
          id: request.id,
          type: "speechVoiceCatalog",
          catalog: { available: true, voices: [voice] },
        };
      if (request.type === "startSpeechDownload") {
        if (blockStart)
          return new Promise(resolve => {
            startResolve = resolve;
          });
        return settle(request);
      }
      if (request.type === "cancelSpeechDownload")
        return settle(request, {
          subscription: "absent",
          cancelFenced: true,
          shared: true,
        });
      if (request.type === "inspectSpeechDownloads" && inspectFailures-- > 0)
        throw new Error("inspection unavailable");
      if (request.type === "inspectSpeechDownloads")
        return {
          id: request.id,
          type: "speechDownloadObservations",
          observations: request.operations.map(operation => ({
            ...operation,
            resource: "absent",
            subscription: "absent",
            ordering: "settled",
            cancelFenced: true,
            shared: true,
          })),
        };
      throw new Error("unexpected request " + request.type);
    },
  };
  const storage = {
    async get() {
      return stored === undefined ? {} : { [SPEECH_DOWNLOAD_STORAGE_KEY]: stored };
    },
    async set(values: Record<string, unknown>) {
      if (failWrites) throw new Error("disk full");
      if (++writes === 2 && blockMarker)
        await new Promise<void>(resolve => {
          releaseMarker = resolve;
        });
      stored = values[SPEECH_DOWNLOAD_STORAGE_KEY];
    },
  };
  const runtime = { id: "test-extension", onConnect: { addListener() {} } };
  const timers = {
    set: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clear: () => {},
  };
  const controller = new SpeechDownloadController(
    gateway,
    storage as never,
    runtime as never,
    timers,
  );
  return {
    controller,
    requests,
    failInspections(count: number) {
      inspectFailures = count;
    },
    get stored() {
      return stored;
    },
    set failWrites(value: boolean) {
      failWrites = value;
    },
    get retained() {
      return retained;
    },
    block() {
      blockStart = true;
    },
    blockMarker() {
      blockMarker = true;
    },
    releaseMarker() {
      releaseMarker?.();
    },
    resolveStart() {
      const request = requests.find(item => item.type === "startSpeechDownload");
      if (!request || request.type !== "startSpeechDownload" || !startResolve)
        throw new Error("start not pending");
      startResolve(settle(request));
    },
  };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("inspection cannot end a download while its dispatch marker is being saved", async () => {
  const app = harness();
  app.block();
  app.blockMarker();
  await app.controller.install();
  await app.controller.start(voice.id);
  await tick();
  const inspection = app.controller.reconcile();
  await tick();
  assert.equal(
    app.requests.some(request => request.type === "inspectSpeechDownloads"),
    false,
  );
  app.releaseMarker();
  await inspection;
  await tick();
  app.resolveStart();
  await tick();
  assert.equal(app.controller.snapshot().tasks[0].progress.status, "waiting-system");
});

test("a restart ends a never-dispatched intent as interrupted without replaying it", async () => {
  const at = new Date().toISOString();
  const app = harness({
    version: 1,
    records: [
      {
        task: {
          id: randomUUID(),
          voice,
          createdAt: at,
          updatedAt: at,
          progress: { status: "requesting" },
          observation: { kind: "reconciling" },
        },
        dispatch: "intent",
        cancelRequested: false,
        sawSubscription: false,
        withdrawalSettled: false,
      },
    ],
  });
  await app.controller.install();
  await tick();
  const task = app.controller.snapshot().tasks[0];
  assert.equal(task.progress.status, "failed");
  if (task.progress.status === "failed") assert.equal(task.progress.reason, "subscription-lost");
  assert.equal(
    app.requests.some(request => request.type === "startSpeechDownload"),
    false,
  );
  assert.equal(app.retained, 0);
});

test("intent is durable before native start, and storage failure prevents dispatch", async () => {
  const app = harness();
  await app.controller.install();
  app.failWrites = true;
  await assert.rejects(app.controller.start(voice.id), /disk full/);
  assert.equal(app.requests.filter(request => request.type === "startSpeechDownload").length, 0);
  assert.equal(app.controller.snapshot().service, "storage-error");
});

test("cancel survives an in-flight start, and shared cancellation reports only our withdrawal", async () => {
  const app = harness();
  app.block();
  await app.controller.install();
  const id = await app.controller.start(voice.id);
  await tick();
  assert.equal(app.requests.filter(request => request.type === "startSpeechDownload").length, 1);
  await app.controller.cancel(id);
  await tick();
  app.resolveStart();
  await tick();
  const task = app.controller.snapshot().tasks.find(item => item.id === id);
  assert.deepEqual(task?.progress.status, "cancelled");
  if (task?.progress.status === "cancelled") assert.equal(task.progress.shared, true);
  assert.equal(app.retained, 0);
});

test("restart inspects but never replays a submitted start", async () => {
  const initial = harness();
  initial.block();
  await initial.controller.install();
  await initial.controller.start(voice.id);
  await tick();
  const restarted = harness(initial.stored);
  await restarted.controller.install();
  await tick();
  assert.equal(
    restarted.requests.some(request => request.type === "startSpeechDownload"),
    false,
  );
  assert.equal(
    restarted.requests.some(request => request.type === "inspectSpeechDownloads"),
    true,
  );
});

test("restart withdraws a durable cancellation before inspecting", async () => {
  const id = randomUUID();
  const at = new Date().toISOString();
  const saved = {
    version: 1,
    records: [
      {
        task: {
          id,
          voice,
          createdAt: at,
          updatedAt: at,
          progress: { status: "cancelling" },
          observation: { kind: "fresh", checkedAt: at },
        },
        dispatch: "may-have-been-sent",
        cancelRequested: true,
        sawSubscription: true,
        withdrawalSettled: false,
      },
    ],
  };
  const app = harness(saved);
  await app.controller.install();
  await tick();
  assert.deepEqual(
    app.requests
      .filter(
        request =>
          request.type === "cancelSpeechDownload" || request.type === "inspectSpeechDownloads",
      )
      .map(request => request.type),
    ["cancelSpeechDownload"],
  );
  assert.equal(app.controller.snapshot().tasks[0].progress.status, "cancelled");
});

test("retry fences and inspects the old failed operation before creating a new ID", async () => {
  const oldId = SpeechDownloadIdSchema.parse(randomUUID());
  const at = new Date().toISOString();
  const saved = {
    version: 1,
    records: [
      {
        task: {
          id: oldId,
          voice,
          createdAt: at,
          updatedAt: at,
          progress: {
            status: "failed",
            endedAt: at,
            reason: "resource-unavailable",
          },
          observation: { kind: "fresh", checkedAt: at },
        },
        dispatch: "may-have-been-sent",
        cancelRequested: false,
        sawSubscription: true,
        withdrawalSettled: false,
      },
    ],
  };
  const app = harness(saved);
  await app.controller.install();
  const fresh = await app.controller.retry(oldId);
  await tick();
  assert.notEqual(fresh, oldId);
  assert.deepEqual(
    app.requests
      .filter(request =>
        ["cancelSpeechDownload", "inspectSpeechDownloads", "startSpeechDownload"].includes(
          request.type,
        ),
      )
      .map(request => request.type),
    ["cancelSpeechDownload", "inspectSpeechDownloads", "startSpeechDownload"],
  );
  const records = (
    app.stored as {
      records: { cancelRequested: boolean; withdrawalSettled: boolean }[];
    }
  ).records;
  assert.equal(records[0].cancelRequested, true);
  assert.equal(records[0].withdrawalSettled, true);
});

test("three automatic inspect failures pause and release the lease; manual reconcile resets the budget", async () => {
  const id = randomUUID();
  const at = new Date().toISOString();
  const saved = {
    version: 1,
    records: [
      {
        task: {
          id,
          voice,
          createdAt: at,
          updatedAt: at,
          progress: { status: "waiting-system" },
          observation: { kind: "fresh", checkedAt: at },
        },
        dispatch: "may-have-been-sent",
        cancelRequested: false,
        sawSubscription: true,
        withdrawalSettled: false,
      },
    ],
  };
  const app = harness(saved);
  app.failInspections(3);
  await app.controller.install();
  await tick();
  await assert.rejects(app.controller.reconcile(false), /inspection unavailable/);
  await assert.rejects(app.controller.reconcile(false), /inspection unavailable/);
  assert.equal(app.controller.snapshot().paused, true);
  assert.equal(app.retained, 0);
  await app.controller.reconcile();
  assert.equal(app.controller.snapshot().paused, false);
  assert.equal(app.controller.snapshot().service, "ready");
});

test("unknown storage version preserves saved history and blocks native effects", async () => {
  const app = harness({ version: 2, records: [] });
  await app.controller.install();
  assert.equal(app.controller.snapshot().service, "storage-error");
  await assert.rejects(app.controller.start(voice.id), /unavailable/);
  assert.equal(app.requests.length, 0);
  assert.deepEqual(app.stored, { version: 2, records: [] });
});

test("inspection cannot reject an operation whose start request is still in flight", async () => {
  const app = harness();
  app.block();
  await app.controller.install();
  const id = await app.controller.start(voice.id);
  await tick();
  await app.controller.reconcile();
  assert.equal(
    app.requests.some(request => request.type === "inspectSpeechDownloads"),
    false,
  );
  assert.equal(
    app.controller.snapshot().tasks.find(task => task.id === id)?.progress.status,
    "requesting",
  );
  app.resolveStart();
  await tick();
  assert.equal(
    app.controller.snapshot().tasks.find(task => task.id === id)?.progress.status,
    "waiting-system",
  );
});
