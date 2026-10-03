import { HOST_PROTOCOL_VERSION } from "@immersive/core";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { GENERATION_CONTROLLER_PORT, installGenerationController } from "./generation-controller";

type Listener<T> = (value: T) => void;
function emitter<T>() {
  const listeners: Listener<T>[] = [];
  return {
    addListener: (listener: Listener<T>) => {
      listeners.push(listener);
    },
    fire: (value: T) => {
      for (const listener of listeners) listener(value);
    },
  };
}

function fakePort(name: string, senderId = "immersive-extension-test") {
  const onMessage = emitter<unknown>();
  const onDisconnect = emitter<void>();
  const sent: unknown[] = [];
  let disconnected = false;
  return {
    name,
    sender: { id: senderId, url: "chrome-extension://" + senderId + "/sidepanel.html" },
    onMessage,
    onDisconnect,
    postMessage: (value: unknown) => {
      sent.push(value);
    },
    disconnect: () => {
      if (disconnected) return;
      disconnected = true;
      onDisconnect.fire();
    },
    get sent() {
      return sent;
    },
    get disconnected() {
      return disconnected;
    },
  };
}

function setup(
  onCompleted: (jobId: string, title: string, documentId?: string) => void = () => {},
  onAttention: (jobId: string, title: string, outcome: "interrupted" | "failed") => void = () => {},
  automaticHandshake = true,
) {
  const id = "immersive-extension-test";
  const onConnect = emitter<ReturnType<typeof fakePort>>();
  const native = fakePort("native", id);
  const send = native.postMessage;
  native.postMessage = value => {
    send(value);
    const request = value as { type: string; id: string };
    if (request.type === "health" && automaticHandshake)
      native.onMessage.fire({
        type: "health",
        id: request.id,
        installed: {},
        agents: [],
        protocolVersion: HOST_PROTOCOL_VERSION,
        version: "0.1.0",
        agentMode: "pi-sdk",
      });
  };
  let connections = 0;
  const runtime = {
    id,
    getManifest: () => ({ version: "0.1.0" }),
    onConnect,
    connectNative: (name: string) => {
      assert.equal(name, "dev.immersive.language_learning");
      connections++;
      return native;
    },
  } as unknown as typeof chrome.runtime;
  installGenerationController(runtime, onCompleted, onAttention);
  return {
    native,
    onConnect,
    id,
    get connections() {
      return connections;
    },
    connectPanel: () => {
      const panel = fakePort(GENERATION_CONTROLLER_PORT, id);
      onConnect.fire(panel);
      return panel;
    },
  };
}

test("all Host operations wait for one compatible handshake and retain pending work after panel close", () => {
  const app = setup(undefined, undefined, false);
  const panel = app.connectPanel();
  const jobsId = randomUUID(),
    lessonsId = randomUUID();
  panel.onMessage.fire({ id: jobsId, type: "listJobs" });
  panel.onMessage.fire({ id: lessonsId, type: "listLessons" });
  assert.equal(app.connections, 1);
  assert.equal(app.native.sent.length, 1);
  const handshake = app.native.sent[0] as { id: string };
  app.native.onMessage.fire({
    id: handshake.id,
    type: "health",
    installed: {},
    agents: [],
    version: "0.1.0",
    protocolVersion: HOST_PROTOCOL_VERSION,
    agentMode: "pi-sdk",
  });
  assert.deepEqual(app.native.sent.slice(1), [
    { id: jobsId, type: "listJobs" },
    { id: lessonsId, type: "listLessons" },
  ]);
  panel.disconnect();
  app.native.onMessage.fire({ id: jobsId, type: "jobs", jobs: [] });
  assert.equal(app.native.disconnected, false);
  app.native.onMessage.fire({ id: lessonsId, type: "lessons", lessons: [] });
  assert.equal(app.native.disconnected, true);
});

test("incompatible Host never receives queued business requests", () => {
  for (const mismatch of [
    { protocolVersion: 3 },
    { version: "old" },
    { agentMode: "imported-only" },
  ]) {
    const app = setup(undefined, undefined, false);
    const panel = app.connectPanel();
    const id = randomUUID();
    panel.onMessage.fire({ id, type: "listJobs" });
    const handshake = app.native.sent[0] as { id: string };
    app.native.onMessage.fire({
      id: handshake.id,
      type: "health",
      installed: {},
      agents: [],
      version: "0.1.0",
      protocolVersion: HOST_PROTOCOL_VERSION,
      agentMode: "pi-sdk",
      ...mismatch,
    });
    assert.equal(app.native.sent.length, 1);
    assert.equal(app.native.disconnected, true);
    assert.ok(
      panel.sent.some(
        value =>
          (value as { id?: string; type?: string }).id === id &&
          (value as { type?: string }).type === "error",
      ),
    );
  }
});

test("health reports installed metadata without forwarding business requests to an incompatible Host", () => {
  for (const mismatch of [
    { protocolVersion: 3 },
    { version: "old" },
    { agentMode: "imported-only" },
  ]) {
    const app = setup(undefined, undefined, false);
    const panel = app.connectPanel();
    const healthId = randomUUID(),
      jobsId = randomUUID();
    panel.onMessage.fire({ id: healthId, type: "health" });
    panel.onMessage.fire({ id: jobsId, type: "listJobs" });
    const handshake = app.native.sent[0] as { id: string };
    const health = {
      id: handshake.id,
      type: "health",
      installed: {},
      agents: [],
      version: "0.1.0",
      protocolVersion: HOST_PROTOCOL_VERSION,
      agentMode: "pi-sdk",
      ...mismatch,
    };
    app.native.onMessage.fire(health);
    assert.deepEqual(
      panel.sent.find(value => (value as { id?: string }).id === healthId),
      { ...health, id: healthId },
    );
    assert.equal(
      (panel.sent.find(value => (value as { id?: string }).id === jobsId) as { type: string }).type,
      "error",
    );
    assert.equal(app.native.sent.length, 1);
    assert.equal(app.native.disconnected, true);
  }
});

test("a compatible health check uses the handshake response without a second Native request", () => {
  const app = setup();
  const panel = app.connectPanel(),
    id = randomUUID();
  panel.onMessage.fire({ id, type: "health" });
  assert.equal(app.native.sent.length, 1);
  assert.equal(
    (panel.sent.find(value => (value as { id?: string }).id === id) as { type: string }).type,
    "health",
  );
  panel.disconnect();
  assert.equal(app.native.disconnected, true);
});

test("checking an already connected Host sends a fresh health request each time", () => {
  const app = setup();
  const panel = app.connectPanel();
  panel.onMessage.fire({ id: randomUUID(), type: "health" });
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = randomUUID();
    panel.onMessage.fire({ id, type: "health" });
    assert.deepEqual(app.native.sent.at(-1), { id, type: "health" });
    assert.equal(app.native.sent.length, attempt + 2);
    assert.ok(
      panel.sent.some(
        value =>
          (value as { id?: string; type?: string }).id === id &&
          (value as { type?: string }).type === "health",
      ),
    );
  }
});

test("login answers belong to their panel and closing its owner cancels only that login", () => {
  const app = setup();
  const owner = app.connectPanel(),
    observer = app.connectPanel();
  const loginId = randomUUID(),
    jobsId = randomUUID();
  owner.onMessage.fire({ id: loginId, type: "piLogin", provider: "openai", method: "api_key" });
  observer.onMessage.fire({
    id: randomUUID(),
    type: "piAuthAnswer",
    loginId,
    promptId: randomUUID(),
    value: "key",
  });
  assert.equal((app.native.sent.at(-1) as { type: string }).type, "piLogin");
  observer.onMessage.fire({ id: jobsId, type: "listJobs" });
  owner.disconnect();
  assert.equal((app.native.sent.at(-1) as { type: string }).type, "piAuthCancel");
  observer.disconnect();
  assert.equal(app.native.disconnected, false);
  app.native.onMessage.fire({ id: jobsId, type: "jobs", jobs: [] });
  assert.equal(app.native.disconnected, true);
});

test("closing the Side Panel retains the live Native Host and new panel can observe progress", () => {
  const app = setup();
  const first = app.connectPanel();
  const requestId = randomUUID(),
    jobId = randomUUID();
  first.onMessage.fire({ type: "resume", id: requestId, jobId });
  assert.equal(app.connections, 1);
  assert.deepEqual(app.native.sent.at(-1), { type: "resume", id: requestId, jobId });

  first.disconnect();
  assert.equal(app.native.disconnected, false);

  app.native.onMessage.fire({
    id: requestId,
    type: "job",
    job: {
      id: jobId,
      sourceTitle: "Test",
      provider: "openai",
      status: "running",
      completed: 3,
      total: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const second = app.connectPanel();
  second.onMessage.fire({ type: "watch" });
  const state = second.sent.at(-1) as {
    type: string;
    active: { requestId: string; jobId: string; summary: { completed: number } };
  };
  assert.equal(state.type, "generationState");
  assert.equal(state.active.requestId, requestId);
  assert.equal(state.active.jobId, jobId);
  assert.equal(state.active.summary.completed, 3);

  app.native.onMessage.fire({ id: requestId, type: "progress", jobId, completed: 4, total: 5 });
  assert.ok(
    second.sent.some(
      message =>
        (message as { type?: string; completed?: number }).type === "progress" &&
        (message as { completed?: number }).completed === 4,
    ),
  );
  second.disconnect();
  assert.equal(app.native.disconnected, false);

  app.native.onMessage.fire({ id: requestId, type: "error", message: "Agent interrupted" });
  assert.equal(app.native.disconnected, true);
});

test("duplicate check and authorized generation share the same Host process and check token", () => {
  const app = setup();
  const panel = app.connectPanel();
  const checkId = randomUUID(),
    token = randomUUID(),
    jobId = randomUUID();
  const payload = {
    id: jobId,
    source: { platform: "youtube", title: "A video" },
    profile: {
      targetLanguage: "en",
      instructionLanguage: "zh-TW",
      level: "B1",
      sceneCount: 4,
      contextualExampleCount: 2,
    },
    agent: { provider: "openai", modelId: "" },
    cues: [{ id: "line-1", startMs: 1_000, endMs: 2_000, originalText: "Hello" }],
  };
  panel.onMessage.fire({ type: "checkDuplicates", id: checkId, payload });
  assert.equal(app.connections, 1);
  app.native.onMessage.fire({ type: "duplicates", id: checkId, token, matches: [] });
  panel.onMessage.fire({
    type: "generate",
    id: jobId,
    payload,
    checkToken: token,
    confirmRegeneration: false,
  });
  assert.equal(app.connections, 1);
  assert.deepEqual(app.native.sent.at(-1), {
    type: "generate",
    id: jobId,
    payload,
    checkToken: token,
    confirmRegeneration: false,
  });
  panel.disconnect();
  assert.equal(app.native.disconnected, false);
  app.native.onMessage.fire({ id: jobId, type: "published", jobId, location: "/tmp/lesson" });
  assert.equal(app.native.disconnected, false, "backup may still be running after delivery");
  app.native.onMessage.fire({ id: jobId, type: "generationSettled" });
  assert.equal(app.native.disconnected, true);
});

test("a native crash is relayed to all live panels, without claiming the job finished", () => {
  const app = setup();
  const panel = app.connectPanel();
  const requestId = randomUUID(),
    jobId = randomUUID();
  panel.onMessage.fire({ type: "resume", id: requestId, jobId });
  app.native.disconnect();
  assert.ok(
    panel.sent.some(
      message =>
        (message as { id?: string; type?: string }).id === requestId &&
        (message as { type?: string }).type === "error",
    ),
  );
  const last = panel.sent.at(-1) as { type: string; active: unknown };
  assert.equal(last.type, "generationState");
  assert.equal(last.active, null);
});

test("an invalid preflight or a foreign UI client cannot reach the native Host", () => {
  const app = setup();
  const foreign = fakePort(GENERATION_CONTROLLER_PORT, "other-extension");
  app.onConnect.fire(foreign);
  assert.equal(foreign.disconnected, true);
  const panel = app.connectPanel();
  panel.onMessage.fire({ type: "checkDuplicates", id: randomUUID(), payload: { invalid: true } });
  assert.equal(app.connections, 0);
  assert.equal((panel.sent.at(-1) as { type: string }).type, "error");
});

test("an internal content-script port cannot run an Agent through the worker", () => {
  const app = setup();
  const contentScript = fakePort(GENERATION_CONTROLLER_PORT, app.id);
  Object.assign(contentScript.sender, {
    url: "https://www.netflix.com/watch/81234567",
    tab: { id: 42 },
  });
  app.onConnect.fire(contentScript);
  assert.equal(contentScript.disconnected, true);
  assert.equal(app.connections, 0);
});

test("pending Drive backups survive Side Panel closure until the Host finishes", () => {
  const app = setup();
  const panel = app.connectPanel();
  const id = randomUUID();
  panel.onMessage.fire({ type: "resumeBackups", id });
  assert.equal(app.connections, 1);
  panel.disconnect();
  assert.equal(app.native.disconnected, false);
  app.native.onMessage.fire({ id, type: "backupsFinished" });
  assert.equal(app.native.disconnected, true);
});

test("completion notifies once after the panel closes; errors do not notify", () => {
  const notifications: string[] = [];
  const app = setup(jobId => notifications.push(jobId));
  const panel = app.connectPanel();
  const id = randomUUID(),
    jobId = randomUUID();
  panel.onMessage.fire({ type: "resume", id, jobId });
  panel.disconnect();
  const now = new Date().toISOString();
  app.native.onMessage.fire({
    type: "job",
    id,
    job: {
      id: jobId,
      provider: "openai",
      sourceTitle: "Video",
      status: "completed",
      completed: 1,
      total: 1,
      createdAt: now,
      updatedAt: now,
      documentId: jobId,
    },
  });
  app.native.onMessage.fire({ type: "generationSettled", id });
  app.native.onMessage.fire({ type: "generationSettled", id });
  assert.deepEqual(notifications, [jobId]);
  const second = app.connectPanel();
  const failedId = randomUUID();
  second.onMessage.fire({ type: "resume", id: failedId, jobId: randomUUID() });
  app.native.onMessage.fire({ type: "error", id: failedId, message: "Failed" });
  assert.deepEqual(notifications, [jobId]);
});

test("failed, disconnected, and cancelled tasks notify attention once; unrelated requests stay quiet", () => {
  for (const kind of ["error", "disconnect", "cancelled", "invalid"] as const) {
    const outcomes: string[] = [];
    const app = setup(
      () => assert.fail("must not notify completion"),
      (_id, _title, outcome) => outcomes.push(outcome),
    );
    const panel = app.connectPanel();
    const id = randomUUID(),
      jobId = randomUUID();
    panel.onMessage.fire({ type: "resume", id, jobId });
    panel.disconnect();
    if (kind === "disconnect") app.native.disconnect();
    else if (kind === "invalid") app.native.onMessage.fire({ broken: true });
    else
      app.native.onMessage.fire(
        kind === "error"
          ? { type: "error", id, message: "failed" }
          : { type: "cancelled", id, jobId },
      );
    app.native.onMessage.fire({ type: "generationSettled", id });
    assert.deepEqual(outcomes, [kind === "error" ? "failed" : "interrupted"]);
  }
  const outcomes: string[] = [];
  const app = setup(
    () => {},
    (_id, _title, outcome) => outcomes.push(outcome),
  );
  const panel = app.connectPanel();
  const id = randomUUID();
  panel.onMessage.fire({ type: "resumeBackups", id });
  app.native.onMessage.fire({ type: "error", id, message: "backup failed" });
  assert.deepEqual(outcomes, []);
});

test("settlement without a completed saved lesson reports interruption", () => {
  const outcomes: string[] = [];
  const app = setup(
    () => assert.fail("no lesson was saved"),
    (_id, _title, outcome) => outcomes.push(outcome),
  );
  const panel = app.connectPanel();
  const id = randomUUID();
  panel.onMessage.fire({ type: "resume", id, jobId: randomUUID() });
  app.native.onMessage.fire({ type: "generationSettled", id });
  assert.deepEqual(outcomes, ["interrupted"]);
});

test("a separate cancel request reports interruption without duplicating the later generation error", () => {
  const outcomes: string[] = [];
  const app = setup(
    () => assert.fail("cancelled job is not complete"),
    (_id, _title, outcome) => outcomes.push(outcome),
  );
  const panel = app.connectPanel();
  const id = randomUUID(),
    cancelId = randomUUID(),
    jobId = randomUUID();
  panel.onMessage.fire({ type: "resume", id, jobId });
  panel.onMessage.fire({ type: "cancel", id: cancelId, jobId });
  app.native.onMessage.fire({ type: "cancelled", id: cancelId });
  app.native.onMessage.fire({ type: "error", id, message: "aborted" });
  assert.deepEqual(outcomes, ["interrupted"]);
});

test("reconnection waits 1/2/4 seconds, queries only and never replays generation", () => {
  const onConnect = emitter<ReturnType<typeof fakePort>>();
  const natives: ReturnType<typeof fakePort>[] = [];
  const delays: number[] = [];
  let retry: (() => void) | undefined;
  const runtime = {
    id: "immersive-extension-test",
    onConnect,
    getManifest: () => ({ version: "0.1.0" }),
    connectNative: () => {
      const native = fakePort("native");
      natives.push(native);
      return native;
    },
  } as unknown as typeof chrome.runtime;
  installGenerationController(
    runtime,
    () => {},
    () => {},
    {
      set: (callback, delay) => {
        retry = callback;
        delays.push(delay);
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clear: () => {
        retry = undefined;
      },
    },
  );
  const panel = fakePort(GENERATION_CONTROLLER_PORT);
  onConnect.fire(panel);
  panel.onMessage.fire({ type: "listJobs", id: randomUUID() });
  const handshake = (native: ReturnType<typeof fakePort>) => {
    const health = native.sent.find(item => (item as { type: string }).type === "health") as {
      id: string;
    };
    native.onMessage.fire({
      type: "health",
      id: health.id,
      installed: { openai: true },
      agents: [{ id: "openai", label: "OpenAI", installed: true }],
      protocolVersion: HOST_PROTOCOL_VERSION,
      version: "0.1.0",
      agentMode: "pi-sdk",
    });
  };
  handshake(natives[0]);
  // A lost mutating operation must fail once, then recovery uses fresh health and listJobs only.
  panel.onMessage.fire({ type: "resumeCustom", id: randomUUID(), jobId: randomUUID() });
  natives[0].disconnect();
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.ok(retry);
    const scheduled = retry;
    retry = undefined;
    scheduled();
    const native = natives.at(-1)!;
    assert.deepEqual(
      native.sent.map(item => (item as { type: string }).type),
      ["health"],
    );
    handshake(native);
    assert.deepEqual(
      native.sent.map(item => (item as { type: string }).type),
      ["health", "listJobs"],
    );
    const query = native.sent.at(-1) as { id: string };
    native.onMessage.fire({ type: "error", id: query.id, message: "status unavailable" });
  }
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.ok(
    panel.sent.some(item => {
      const state = item as { connection?: { status: string } };
      return state.connection?.status === "failed";
    }),
  );
  assert.equal(natives.length, 4);
  assert.equal(retry, undefined);
  panel.disconnect();
});

test("custom completion survives panel closure and notifies once with its content kind", () => {
  const completed: unknown[][] = [];
  const app = setup((...values) => completed.push(values));
  const panel = app.connectPanel(),
    id = randomUUID(),
    jobId = randomUUID();
  panel.onMessage.fire({ id, type: "resumeCustom", jobId });
  panel.disconnect();
  assert.equal(app.native.disconnected, false);
  const now = new Date().toISOString();
  app.native.onMessage.fire({
    id,
    type: "job",
    job: {
      id: jobId,
      kind: "custom",
      provider: "openai",
      sourceTitle: "Custom notes",
      status: "completed",
      createdAt: now,
      updatedAt: now,
      completed: 1,
      total: 1,
      documentId: jobId,
    },
  });
  app.native.onMessage.fire({
    id,
    type: "customChunk",
    resource: "document",
    resourceId: jobId,
    total: 1,
    index: 0,
    dataBase64: "e30=",
  });
  app.native.onMessage.fire({ id, type: "generationSettled" });
  app.native.onMessage.fire({ id, type: "generationSettled" });
  assert.deepEqual(completed, [[jobId, "Custom notes", jobId, "custom"]]);
  assert.equal(
    app.native.sent.some(value => (value as { type: string }).type === "cancelCustom"),
    false,
  );
});

test("worker tracks FIFO queue and sends completion once for each job across panel close", () => {
  const completed: string[] = [],
    app = setup(jobId => completed.push(jobId));
  const panel = app.connectPanel(),
    first = randomUUID(),
    second = randomUUID();
  panel.onMessage.fire({ type: "resume", id: first, jobId: first });
  panel.onMessage.fire({ type: "resumeCustom", id: second, jobId: second });
  const summary = (id: string, status: "queued" | "running" | "completed") => ({
    id,
    status,
    sourceTitle: id,
    provider: "openai",
    total: 1,
    completed: status === "completed" ? 1 : 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(status === "completed" ? { documentId: id } : {}),
  });
  app.native.onMessage.fire({ type: "job", id: first, job: summary(first, "running") });
  app.native.onMessage.fire({
    type: "job",
    id: second,
    job: { ...summary(second, "queued"), kind: "custom" },
  });
  const state = panel.sent.at(-1) as {
    active: { requestId: string };
    queue: { requestId: string }[];
  };
  assert.equal(state.active.requestId, first);
  assert.equal(state.queue[0].requestId, second);
  panel.disconnect();
  assert.equal(app.native.disconnected, false);
  for (const id of [first, second]) {
    app.native.onMessage.fire({ type: "job", id, job: summary(id, "completed") });
    app.native.onMessage.fire({ type: "generationSettled", id });
    app.native.onMessage.fire({ type: "generationSettled", id });
    if (id === first) assert.equal(app.native.disconnected, false);
  }
  assert.deepEqual(completed, [first, second]);
  assert.equal(app.native.disconnected, true);
});
