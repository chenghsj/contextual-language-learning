import { HOST_PROTOCOL_VERSION } from "@contextual/core";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { GENERATION_CONTROLLER_PORT, installGenerationController } from "./generation-controller";

test("speech has a panel owner, stops on panel closure, and does not interrupt generation", () => {
  const app = setup();
  const first = app.connectPanel();
  const second = app.connectPanel();
  const jobId = randomUUID(),
    speechId = randomUUID(),
    stopId = randomUUID();
  first.onMessage.fire({ id: jobId, type: "resume", jobId });
  first.onMessage.fire({
    id: speechId,
    type: "speak",
    input: { text: "Hello", language: "en", voiceId: "Alex", rate: 1 },
  });
  second.onMessage.fire({ id: stopId, type: "stopSpeech", speechId });
  assert.ok(
    second.sent.some(
      message =>
        (message as { id: string; type: string }).id === stopId &&
        (message as { type: string }).type === "error",
    ),
  );
  assert.equal(
    app.native.sent.some(message => (message as { id: string }).id === stopId),
    false,
  );
  first.disconnect();
  assert.ok(
    app.native.sent.some(
      message =>
        (message as { type: string; speechId?: string }).type === "stopSpeech" &&
        (message as { speechId: string }).speechId === speechId,
    ),
  );
  app.native.onMessage.fire({ id: speechId, type: "speechFinished", status: "stopped" });
  second.disconnect();
  assert.equal(app.native.disconnected, false, "the generation request survives speech cleanup");
  app.native.onMessage.fire({ id: jobId, type: "generationSettled" });
  assert.equal(app.native.disconnected, true);
});

test("speech queued before the handshake is removed when its panel closes", () => {
  const app = setup(
    () => {},
    () => {},
    false,
  );
  const panel = app.connectPanel();
  panel.onMessage.fire({
    id: randomUUID(),
    type: "speak",
    input: { text: "Hello", language: "en", voiceId: "Alex", rate: 1 },
  });
  panel.disconnect();
  assert.equal(
    app.native.sent.some(message => (message as { type: string }).type === "speak"),
    false,
  );
  assert.equal(app.native.disconnected, true);
});

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

function fakePort(name: string, senderId = "contextual-extension-test") {
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
  const id = "contextual-extension-test";
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
  let registered = true;
  const probes: { request: { id: string; type: string }; reply: (value: unknown) => void }[] = [];
  const runtime = {
    id,
    getManifest: () => ({ version: "0.1.0" }),
    onConnect,
    sendNativeMessage: (
      name: string,
      request: { id: string; type: string },
      reply: (value: unknown) => void,
    ) => {
      assert.equal(name, "dev.contextual.language_learning");
      connections++;
      if (!registered) throw new Error("Specified native messaging host not found.");
      probes.push({ request, reply });
      if (automaticHandshake)
        reply({
          type: "health",
          id: request.id,
          installed: {},
          agents: [],
          protocolVersion: HOST_PROTOCOL_VERSION,
          version: "0.1.0",
          agentMode: "pi-sdk",
        });
    },
    connectNative: (name: string) => {
      assert.equal(name, "dev.contextual.language_learning");
      connections++;
      if (!registered) throw new Error("Specified native messaging host not found.");
      return native;
    },
  } as unknown as typeof chrome.runtime;
  installGenerationController(runtime, onCompleted, onAttention);
  return {
    native,
    probes,
    runtime,
    onConnect,
    id,
    uninstall: () => {
      registered = false;
    },
    reinstall: () => {
      registered = true;
    },
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

test("health detects uninstall despite a still-responsive existing Host connection", () => {
  const app = setup();
  const observer = app.connectPanel();
  observer.onMessage.fire({ type: "watch" });
  const panel = app.connectPanel();
  panel.onMessage.fire({ id: randomUUID(), type: "listJobs" });
  // The browser registration is gone, but the process behind the existing port
  // remains alive and continues answering health requests.
  app.uninstall();
  const id = randomUUID();
  panel.onMessage.fire({ id, type: "health" });
  const reply = panel.sent.find(value => (value as { id?: string }).id === id);
  assert.equal((reply as { type: string }).type, "error");
  assert.equal(app.connections, 2);
  assert.equal(app.native.disconnected, false);
  app.native.onMessage.fire({
    id: (app.native.sent.at(-1) as { id: string }).id,
    type: "jobs",
    jobs: [],
  });
  panel.disconnect();
  observer.disconnect();
});

test("successful health retry clears the worker failure status for every panel", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const app = setup();
  const panel = app.connectPanel(),
    observer = app.connectPanel();
  panel.onMessage.fire({ id: randomUUID(), type: "listJobs" });
  app.uninstall();
  app.native.disconnect();
  for (const delay of [1000, 2000, 4000]) context.mock.timers.tick(delay);
  const latestState = (client: typeof panel) =>
    client.sent.filter(value => (value as { type?: string }).type === "generationState").at(-1) as {
      connection: { status: string; attempt: number };
    };
  assert.equal(latestState(panel).connection.status, "failed");
  app.reinstall();
  panel.onMessage.fire({ id: randomUUID(), type: "health" });
  for (const client of [panel, observer])
    assert.deepEqual(latestState(client).connection, { status: "ready", attempt: 0 });
  panel.disconnect();
  observer.disconnect();
});

test("health recovery cancels scheduled reconnects so they cannot restore stale failure", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const app = setup();
  const panel = app.connectPanel();
  panel.onMessage.fire({ id: randomUUID(), type: "listJobs" });
  app.native.disconnect();
  panel.onMessage.fire({ id: randomUUID(), type: "health" });
  const count = app.connections;
  context.mock.timers.tick(10_000);
  assert.equal(app.connections, count);
  const state = panel.sent
    .filter(value => (value as { type?: string }).type === "generationState")
    .at(-1) as { connection: { status: string; attempt: number } };
  assert.deepEqual(state.connection, { status: "ready", attempt: 0 });
  panel.disconnect();
});

test("health retry preserves incompatible status until a compatible Host replies", () => {
  const app = setup(undefined, undefined, false);
  const panel = app.connectPanel();
  panel.onMessage.fire({ id: randomUUID(), type: "listJobs" });
  app.native.onMessage.fire({ invalid: true });
  for (const protocolVersion of [HOST_PROTOCOL_VERSION - 1, HOST_PROTOCOL_VERSION]) {
    const id = randomUUID();
    panel.onMessage.fire({ id, type: "health" });
    app.probes.at(-1)!.reply({
      id,
      type: "health",
      installed: {},
      agents: [],
      version: "0.1.0",
      agentMode: "pi-sdk",
      protocolVersion,
    });
    const state = panel.sent
      .filter(value => (value as { type?: string }).type === "generationState")
      .at(-1) as { connection: { status: string } };
    assert.equal(
      state.connection.status,
      protocolVersion === HOST_PROTOCOL_VERSION ? "ready" : "incompatible",
    );
  }
  panel.disconnect();
});

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
    app.probes[0].reply({ ...health, id: healthId });
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

test("a compatible health check uses one short Native connection", () => {
  const app = setup();
  const panel = app.connectPanel(),
    id = randomUUID();
  panel.onMessage.fire({ id, type: "health" });
  assert.equal(app.probes.length, 1);
  assert.equal(app.native.sent.length, 0);
  assert.equal(
    (panel.sent.find(value => (value as { id?: string }).id === id) as { type: string }).type,
    "health",
  );
  panel.disconnect();
});

test("checking an already connected Host starts a separate short connection each time", () => {
  const app = setup();
  const panel = app.connectPanel();
  const jobId = randomUUID();
  panel.onMessage.fire({ id: jobId, type: "resume", jobId });
  const requests = app.native.sent.length;
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = randomUUID();
    panel.onMessage.fire({ id, type: "health" });
    assert.deepEqual(app.probes.at(-1)?.request, { id, type: "health" });
    assert.equal(app.connections, attempt + 2);
    assert.equal(app.native.sent.length, requests);
    assert.equal(app.native.disconnected, false);
    assert.ok(
      panel.sent.some(
        value =>
          (value as { id?: string; type?: string }).id === id &&
          (value as { type?: string }).type === "health",
      ),
    );
  }
  app.native.onMessage.fire({ id: jobId, type: "generationSettled" });
  panel.disconnect();
});

test("health probes report browser disconnects and reject invalid responses", () => {
  for (const response of [
    { invalid: true },
    { type: "jobs", id: randomUUID(), jobs: [] },
    { type: "health", id: randomUUID(), installed: {}, agents: [] },
    undefined,
  ]) {
    const app = setup(undefined, undefined, false);
    const panel = app.connectPanel();
    const id = randomUUID();
    panel.onMessage.fire({ id, type: "health" });
    if (!response)
      Object.assign(app.runtime, {
        lastError: { message: "Specified native messaging host not found." },
      });
    app.probes[0].reply(response);
    Object.assign(app.runtime, { lastError: undefined });
    assert.equal(
      (panel.sent.find(value => (value as { id?: string }).id === id) as { type: string }).type,
      "error",
    );
    panel.disconnect();
  }
});

test("health timeout fails once and panel close suppresses late replies", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const app = setup(undefined, undefined, false);
  const panel = app.connectPanel();
  const id = randomUUID();
  panel.onMessage.fire({ id, type: "health" });
  context.mock.timers.tick(10_000);
  assert.equal(
    (panel.sent.find(value => (value as { id?: string }).id === id) as { type: string }).type,
    "error",
  );
  const count = panel.sent.length;
  app.probes[0].reply({ type: "error", id, message: "late" });
  assert.equal(panel.sent.length, count);
  panel.onMessage.fire({ id: randomUUID(), type: "health" });
  panel.disconnect();
  app.probes[1].reply({ type: "error", id: app.probes[1].request.id, message: "late" });
  context.mock.timers.tick(10_000);
  assert.equal(panel.sent.length, count);
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
    id: "contextual-extension-test",
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

test("the login owner can submit its prompt using the active login ID without bypassing duplicate checks", () => {
  const app = setup();
  const owner = app.connectPanel();
  const observer = app.connectPanel();
  const loginId = randomUUID();
  const login = { id: loginId, type: "piLogin", provider: "openai", method: "api_key" };
  owner.onMessage.fire(login);
  const answer = {
    id: loginId,
    type: "piAuthAnswer",
    loginId,
    promptId: randomUUID(),
    value: "test-only-key",
  };
  owner.onMessage.fire(answer);
  assert.deepEqual(app.native.sent.at(-1), answer);
  const count = app.native.sent.length;
  observer.onMessage.fire(answer);
  owner.onMessage.fire(login);
  owner.onMessage.fire({ id: loginId, type: "listJobs" });
  assert.equal(app.native.sent.length, count);
  assert.match((observer.sent.at(-1) as { message: string }).message, /already in use/);
  app.native.onMessage.fire({ id: loginId, type: "piAuthDone" });
  assert.ok(
    owner.sent.some(
      message =>
        (message as { id: string; type: string }).id === loginId &&
        (message as { type: string }).type === "piAuthDone",
    ),
  );
  owner.disconnect();
  observer.disconnect();
});

test("silent catalog requests fail in bounded time without interrupting generation", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const app = setup();
  const panel = app.connectPanel();
  const generationId = randomUUID();
  panel.onMessage.fire({ id: generationId, type: "resume", jobId: randomUUID() });
  for (const type of [
    "listLessons",
    "listCustomDocuments",
    "listDriveLessons",
    "listCustomDriveDocuments",
  ]) {
    const id = randomUUID();
    panel.onMessage.fire({ id, type, ...(type.includes("Drive") ? { accountId: "account" } : {}) });
    context.mock.timers.tick(30_000);
    assert.ok(
      panel.sent.some(value => {
        const message = value as { id?: string; type: string; message?: string };
        return (
          message.id === id && message.type === "error" && /timed out/.test(message.message ?? "")
        );
      }),
      type + " must stop waiting and report a retryable failure",
    );
  }
  panel.disconnect();
  assert.equal(app.native.disconnected, false, "generation survives catalog timeouts");
  app.native.onMessage.fire({ id: generationId, type: "generationSettled" });
  assert.equal(app.native.disconnected, true, "timed-out requests no longer retain the host");
});

test("successful catalogs cancel their deadlines and accept a fresh retry", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const app = setup();
  const panel = app.connectPanel();
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = randomUUID();
    panel.onMessage.fire({ id, type: "listLessons" });
    app.native.onMessage.fire({ id, type: "lessons", lessons: [] });
    context.mock.timers.tick(30_000);
    assert.equal(panel.sent.filter(value => (value as { id?: string }).id === id).length, 1);
  }
  panel.disconnect();
  assert.equal(app.native.disconnected, true);
});
