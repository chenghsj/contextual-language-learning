import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { GENERATION_CONTROLLER_PORT, installGenerationController } from "./generation-controller";

type Listener<T> = (value: T) => void;
function emitter<T>() {
  const listeners: Listener<T>[] = [];
  return {
    addListener: (listener: Listener<T>) => { listeners.push(listener); },
    fire: (value: T) => { for (const listener of listeners) listener(value); },
  };
}

function fakePort(name: string, senderId = "immersive-extension-test") {
  const onMessage = emitter<unknown>();
  const onDisconnect = emitter<void>();
  const sent: unknown[] = [];
  let disconnected = false;
  return {
    name, sender: { id: senderId, url: "chrome-extension://" + senderId + "/sidepanel.html" }, onMessage, onDisconnect,
    postMessage: (value: unknown) => { sent.push(value); },
    disconnect: () => {
      if (disconnected) return;
      disconnected = true;
      onDisconnect.fire();
    },
    get sent() { return sent; },
    get disconnected() { return disconnected; },
  };
}

function setup(onCompleted: (jobId: string, title: string, documentId?: string) => void = () => {},
  onAttention: (jobId: string, title: string, outcome: "interrupted" | "failed") => void = () => {}) {
  const id = "immersive-extension-test";
  const onConnect = emitter<ReturnType<typeof fakePort>>();
  const native = fakePort("native", id);
  let connections = 0;
  const runtime = {
    id, onConnect,
    connectNative: (name: string) => {
      assert.equal(name, "dev.immersive.language_learning");
      connections++;
      return native;
    },
  } as unknown as typeof chrome.runtime;
  installGenerationController(runtime, onCompleted, onAttention);
  return {
    native, onConnect, id,
    get connections() { return connections; },
    connectPanel: () => {
      const panel = fakePort(GENERATION_CONTROLLER_PORT, id);
      onConnect.fire(panel);
      return panel;
    },
  };
}

test("closing the Side Panel retains the live Native Host and new panel can observe progress", () => {
  const app = setup();
  const first = app.connectPanel();
  const requestId = randomUUID(), jobId = randomUUID();
  first.onMessage.fire({ type: "resume", id: requestId, jobId });
  assert.equal(app.connections, 1);
  assert.deepEqual(app.native.sent.at(-1), { type: "resume", id: requestId, jobId });

  first.disconnect();
  assert.equal(app.native.disconnected, false);

  app.native.onMessage.fire({ id: requestId, type: "job",
    job: { id: jobId, sourceTitle: "Test", provider: "custom-" + "a".repeat(24),
      status: "running", completed: 3, total: 5,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  const second = app.connectPanel();
  second.onMessage.fire({ type: "watch" });
  const state = second.sent.at(-1) as {
    type: string; active: { requestId: string; jobId: string; summary: { completed: number } };
  };
  assert.equal(state.type, "generationState");
  assert.equal(state.active.requestId, requestId);
  assert.equal(state.active.jobId, jobId);
  assert.equal(state.active.summary.completed, 3);

  app.native.onMessage.fire({ id: requestId, type: "progress", jobId, completed: 4, total: 5 });
  assert.ok(second.sent.some(message =>
    (message as { type?: string; completed?: number }).type === "progress" &&
    (message as { completed?: number }).completed === 4));
  second.disconnect();
  assert.equal(app.native.disconnected, false);

  app.native.onMessage.fire({ id: requestId, type: "error", message: "Agent interrupted" });
  assert.equal(app.native.disconnected, true);
});

test("duplicate check and authorized generation share the same Host process and check token", () => {
  const app = setup();
  const panel = app.connectPanel();
  const checkId = randomUUID(), token = randomUUID(), jobId = randomUUID();
  const payload = {
    id: jobId, source: { platform: "youtube", title: "A video" },
    profile: {
      targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
      sceneCount: 4, contextualExampleCount: 2,
    },
    agent: { provider: "custom-" + "a".repeat(24), modelId: "" },
    cues: [{ id: "line-1", startMs: 1_000, endMs: 2_000, originalText: "Hello" }],
  };
  panel.onMessage.fire({ type: "checkDuplicates", id: checkId, payload });
  assert.equal(app.connections, 1);
  app.native.onMessage.fire({ type: "duplicates", id: checkId, token, matches: [] });
  panel.onMessage.fire({
    type: "generate", id: jobId, payload, checkToken: token, confirmRegeneration: false,
  });
  assert.equal(app.connections, 1);
  assert.deepEqual(app.native.sent.at(-1), {
    type: "generate", id: jobId, payload, checkToken: token, confirmRegeneration: false,
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
  const requestId = randomUUID(), jobId = randomUUID();
  panel.onMessage.fire({ type: "resume", id: requestId, jobId });
  app.native.disconnect();
  assert.ok(panel.sent.some(message =>
    (message as { id?: string; type?: string }).id === requestId &&
    (message as { type?: string }).type === "error"));
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
    url: "https://www.netflix.com/watch/81234567", tab: { id: 42 },
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
  const app = setup((jobId) => notifications.push(jobId));
  const panel = app.connectPanel();
  const id = randomUUID(), jobId = randomUUID();
  panel.onMessage.fire({ type: "resume", id, jobId });
  panel.disconnect();
  const now = new Date().toISOString();
  app.native.onMessage.fire({ type: "job", id, job: { id: jobId, provider: "openai", sourceTitle: "Video",
    status: "completed", completed: 1, total: 1, createdAt: now, updatedAt: now, documentId: jobId } });
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
    const app = setup(() => assert.fail("must not notify completion"), (_id, _title, outcome) => outcomes.push(outcome));
    const panel = app.connectPanel();
    const id = randomUUID(), jobId = randomUUID();
    panel.onMessage.fire({ type: "resume", id, jobId });
    panel.disconnect();
    if (kind === "disconnect") app.native.disconnect();
    else if (kind === "invalid") app.native.onMessage.fire({ broken: true });
    else app.native.onMessage.fire(kind === "error" ? { type: "error", id, message: "failed" } : { type: "cancelled", id, jobId });
    app.native.onMessage.fire({ type: "generationSettled", id });
    assert.deepEqual(outcomes, [kind === "error" ? "failed" : "interrupted"]);
  }
  const outcomes: string[] = [];
  const app = setup(() => {}, (_id, _title, outcome) => outcomes.push(outcome));
  const panel = app.connectPanel();
  const id = randomUUID();
  panel.onMessage.fire({ type: "resumeBackups", id });
  app.native.onMessage.fire({ type: "error", id, message: "backup failed" });
  assert.deepEqual(outcomes, []);
});

test("settlement without a completed saved lesson reports interruption", () => {
  const outcomes: string[] = [];
  const app = setup(() => assert.fail("no lesson was saved"), (_id, _title, outcome) => outcomes.push(outcome));
  const panel = app.connectPanel();
  const id = randomUUID();
  panel.onMessage.fire({ type: "resume", id, jobId: randomUUID() });
  app.native.onMessage.fire({ type: "generationSettled", id });
  assert.deepEqual(outcomes, ["interrupted"]);
});


test("a separate cancel request reports interruption without duplicating the later generation error", () => {
  const outcomes: string[] = [];
  const app = setup(() => assert.fail("cancelled job is not complete"), (_id, _title, outcome) => outcomes.push(outcome));
  const panel = app.connectPanel();
  const id = randomUUID(), cancelId = randomUUID(), jobId = randomUUID();
  panel.onMessage.fire({ type: "resume", id, jobId });
  panel.onMessage.fire({ type: "cancel", id: cancelId, jobId });
  app.native.onMessage.fire({ type: "cancelled", id: cancelId });
  app.native.onMessage.fire({ type: "error", id, message: "aborted" });
  assert.deepEqual(outcomes, ["interrupted"]);
});
