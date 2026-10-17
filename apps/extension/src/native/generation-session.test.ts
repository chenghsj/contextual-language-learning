import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { document } from "../../dev/reader-fixture";
import { buildGenerationRequest } from "../lib/generation-request";
import {
  GenerationSession,
  type GenerationEvent,
  type GenerationState,
} from "./generation-session";
import type { JobSummary } from "@contextual/core";
import { testRuntime } from "./test-runtime";

function setup() {
  const app = testRuntime();
  const session = new GenerationSession(app.runtime);
  const events: GenerationEvent[] = [];
  let state!: GenerationState;
  session.subscribe(event => {
    events.push(event);
    if (event.type === "state") state = event.state;
  });
  const input = buildGenerationRequest(
    {
      source: document.source,
      profile: document.profile,
      agent: document.generation,
      destination: { kind: "local" },
      backup: { enabled: false },
      cues: document.cues,
    },
    randomUUID(),
  );
  return {
    ...app,
    session,
    events,
    input,
    get state() {
      return state;
    },
  };
}

test("cancellation stays pending until Host acknowledgement and stays unconfirmed after disconnect", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const app = setup();
  const port = app.ports[0];
  port.receive({
    type: "generationState",
    active: { requestId: randomUUID(), jobId: app.input.id },
  });
  app.session.cancel();
  const request = port.sent.at(-1)!;
  assert.equal(app.state.cancellations?.[app.input.id]?.status, "pending");
  context.mock.timers.tick(30_000);
  assert.equal(app.state.cancellations?.[app.input.id]?.status, "unconfirmed");
  port.receive({ id: request.id, type: "cancelled" });
  assert.equal(app.state.cancellations?.[app.input.id], undefined);
  app.session.cancelJob(app.input.id);
  port.disconnect();
  assert.equal(app.state.cancellations?.[app.input.id]?.status, "unconfirmed");
  app.session.dispose();
});

test("confirmed cancellation does not surface the original AI abort as a failure", () => {
  const app = setup(),
    port = app.ports[0],
    requestId = randomUUID();
  port.receive({ type: "generationState", active: { requestId, jobId: app.input.id } });
  app.session.cancel();
  port.receive({
    type: "job",
    id: requestId,
    job: {
      id: app.input.id,
      status: "cancelled",
      sourceTitle: "Cancelled AI",
      provider: "openai",
      completed: 0,
      total: 1,
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
    },
  });
  port.receive({ type: "error", id: requestId, message: "AI aborted after cleanup" });
  assert.equal(
    app.events.some(event => event.type === "error"),
    false,
  );
  app.session.dispose();
});

test("duplicate confirmation uses an immutable checked snapshot; invalidated responses are ignored", () => {
  const app = setup();
  const port = app.ports[0];
  app.session.start(app.input);
  const check = port.sent.at(-1)!;
  const token = randomUUID();
  app.input.source.title = "Changed after check";
  port.receive({
    id: check.id,
    type: "duplicates",
    token,
    matches: [
      {
        documentId: document.id,
        title: "Prior lesson",
        createdAt: document.createdAt,
        destination: "Local",
        exactSettings: true,
        local: true,
      },
    ],
  });
  assert.equal(app.state.duplicate?.payload.source.title, document.source.title);
  assert.ok(Object.isFrozen(app.state.duplicate?.payload.source));
  app.session.confirmRegeneration();
  const generate = port.sent.at(-1)!;
  assert.equal(generate.type, "generate");
  assert.equal(generate.checkToken, token);
  assert.equal(generate.confirmRegeneration, true);
  assert.equal(generate.id, app.input.id);
  assert.equal(
    app.state.checking,
    true,
    "submission remains locked until the immutable input is durably acknowledged",
  );
  const countBeforeAck = port.sent.length;
  app.session.start({ ...app.input, id: randomUUID() });
  assert.equal(port.sent.length, countBeforeAck);
  port.receive({
    type: "job",
    id: app.input.id,
    job: {
      id: app.input.id,
      status: "queued",
      sourceTitle: document.source.title,
      provider: "openai",
      completed: 0,
      total: 1,
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
    },
  });
  assert.equal(app.state.checking, false);
  port.receive({ type: "generationState", active: null });
  app.session.start({ ...app.input, id: randomUUID() });
  const stale = port.sent.at(-1)!;
  app.session.invalidatePreflight();
  const count = port.sent.length;
  port.receive({ id: stale.id, type: "duplicates", token: randomUUID(), matches: [] });
  assert.equal(port.sent.length, count);
  assert.equal(app.state.checking, false);
  app.session.dispose();
  assert.equal(port.closed, true);
});

test("reopened session follows worker state, delivers once and cancels the retained job", () => {
  const app = setup();
  const port = app.ports[0],
    requestId = randomUUID();
  assert.equal(port.sent[0].type, "watch");
  port.receive({ type: "generationState", active: { requestId, jobId: document.id } });
  app.session.cancel();
  assert.equal(port.sent.at(-1)?.jobId, document.id);
  port.receive({ id: requestId, type: "result", document });
  port.receive({ id: requestId, type: "result", document });
  assert.equal(app.events.filter(event => event.type === "document").length, 1);
  port.receive({ type: "generationState", active: null });
  app.session.resume(document.id);
  assert.equal(port.sent.at(-1)?.type, "resume");
  assert.equal(app.state.lastJobId, document.id);
  app.session.dispose();
});

test("late chunk recovery belongs to its original request even when another job is submitted", async () => {
  for (const superseded of [false, true]) {
    const app = setup();
    const port = app.ports[0],
      requestId = randomUUID();
    port.receive({ type: "generationState", active: { requestId, jobId: document.id } });
    port.receive({
      id: requestId,
      type: "documentChunk",
      documentId: document.id,
      index: 1,
      total: 2,
      dataBase64: Buffer.from("tail").toString("base64"),
    });
    const recovery = app.ports[1];
    assert.equal(recovery.sent[0].type, "getDocument");
    port.receive({ type: "generationState", active: null });
    if (superseded) app.session.resume(document.id);
    recovery.receive({ id: recovery.sent[0].id, type: "result", document });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.events.filter(event => event.type === "document").length, 1);
    app.session.dispose();
  }
});

test("custom generation freezes its prompt and preserves multi-chunk delivery across progress updates", () => {
  const app = setup();
  const payload = {
    id: randomUUID(),
    kind: "custom" as const,
    source: document.source,
    agent: document.generation,
    cues: document.cues,
    prompt: "Summarize the source",
    context: { title: true, subtitles: true },
    backup: { enabled: false },
  };
  app.session.start(payload, true);
  const port = app.ports[0],
    check = port.sent.at(-1)!;
  assert.equal(check.type, "checkCustomDuplicates");
  payload.prompt = "Changed draft";
  port.receive({ id: check.id, type: "duplicates", token: randomUUID(), matches: [] });
  const request = port.sent.at(-1)!;
  assert.equal(request.type, "generateCustom");
  const frozen = request.payload as typeof payload;
  assert.equal(frozen.prompt, "Summarize the source");
  assert.equal(request.confirmRegeneration, true);
  const doc = {
    schemaVersion: "custom-v1",
    kind: "custom",
    id: payload.id,
    title: "Custom",
    createdAt: document.createdAt,
    request: frozen,
    markdown: "# 自訂\n\nSafe content",
    execution: {
      workflowVersion: "custom-workflow-v1",
      promptVersion: "custom-prompt-v1",
      schemaVersion: "custom-v1",
      inputFingerprint: "a".repeat(64),
      provider: "openai",
      modelId: "pinned",
      contextWindow: 16384,
      maxOutputTokens: 4096,
      chunkPlan: [document.cues.map(cue => cue.id)],
      calls: [],
    },
  };
  const bytes = Buffer.from(JSON.stringify(doc)),
    middle = Math.floor(bytes.length / 2);
  port.receive({
    id: payload.id,
    type: "customChunk",
    resource: "document",
    resourceId: payload.id,
    total: 2,
    index: 0,
    dataBase64: bytes.subarray(0, middle).toString("base64"),
  });
  port.receive({
    type: "generationState",
    active: { requestId: payload.id, jobId: payload.id, kind: "custom" },
  });
  port.receive({
    id: payload.id,
    type: "customChunk",
    resource: "document",
    resourceId: payload.id,
    total: 2,
    index: 1,
    dataBase64: bytes.subarray(middle).toString("base64"),
  });
  assert.equal(app.events.filter(event => event.type === "customDocument").length, 1);
  app.session.cancel();
  assert.equal(port.sent.at(-1)?.type, "cancelCustom");
  app.session.dispose();
});

test("enqueueing another job preserves partial document chunks and queued errors", () => {
  const app = setup(),
    port = app.ports[0],
    first = randomUUID();
  port.receive({ type: "generationState", active: { requestId: first, jobId: document.id } });
  const bytes = Buffer.from(JSON.stringify(document)),
    middle = Math.floor(bytes.length / 2);
  port.receive({
    type: "documentChunk",
    id: first,
    documentId: document.id,
    index: 0,
    total: 2,
    dataBase64: bytes.subarray(0, middle).toString("base64"),
  });
  app.session.start(app.input);
  const check = port.sent.at(-1)!;
  port.receive({ type: "duplicates", id: check.id, matches: [], token: randomUUID() });
  assert.equal(app.state.active?.requestId, first);
  port.receive({
    type: "generationState",
    active: { requestId: first, jobId: document.id },
    queue: [{ requestId: app.input.id, jobId: app.input.id }],
  });
  port.receive({
    type: "documentChunk",
    id: first,
    documentId: document.id,
    index: 1,
    total: 2,
    dataBase64: bytes.subarray(middle).toString("base64"),
  });
  assert.equal(app.events.filter(e => e.type === "document").length, 1);
  port.receive({ type: "error", id: app.input.id, message: "Pinned model unavailable" });
  assert.ok(app.events.some(e => e.type === "error" && e.id === app.input.id));
  app.session.cancelJob(app.input.id, "custom");
  assert.equal(port.sent.at(-1)?.type, "cancelCustom");
  app.session.dispose();
});

test("durable admission emits once per new submission, never for replay or restored jobs", () => {
  const app = setup(),
    port = app.ports[0];
  app.session.start(app.input);
  const check = port.sent.at(-1)!;
  port.receive({ id: check.id, type: "duplicates", token: randomUUID(), matches: [] });
  const sent = port.sent.at(-1)! as unknown as { payload: typeof app.input };
  assert.equal(app.state.submitting, true);
  assert.equal(app.events.filter(event => event.type === "admitted").length, 0);
  app.input.source.title = "Next video's edited title";
  app.session.invalidatePreflight();
  assert.equal(sent.payload.source.title, document.source.title);
  assert.equal(app.state.checking, true, "editing does not unlock an unacknowledged request");
  const job: JobSummary = {
    id: app.input.id,
    sourceTitle: document.source.title,
    provider: "openai",
    status: "queued",
    completed: 0,
    total: 6,
    createdAt: document.createdAt,
    updatedAt: document.createdAt,
  };
  port.receive({ id: app.input.id, type: "job", job });
  assert.equal(app.state.submitting, false);
  assert.equal(app.events.filter(event => event.type === "admitted").length, 1);
  port.receive({ id: app.input.id, type: "job", job });
  port.receive({ id: app.input.id, type: "job", job: { ...job, status: "running", completed: 1 } });
  port.receive({
    type: "generationState",
    active: { requestId: job.id, jobId: job.id, summary: job },
  });
  port.receive({ id: randomUUID(), type: "jobs", jobs: [job] });
  assert.equal(app.events.filter(event => event.type === "admitted").length, 1);
  port.disconnect();
  app.session.subscribe(() => {});
  const restored = app.ports.at(-1)!;
  restored.receive({
    type: "generationState",
    active: { requestId: job.id, jobId: job.id, summary: job },
  });
  restored.receive({ id: job.id, type: "job", job });
  assert.equal(app.events.filter(event => event.type === "admitted").length, 1);
  app.session.dispose();
});

test("preflight and admission errors do not report success or retain the submission lock", () => {
  for (const stage of ["preflight", "admission"] as const) {
    const app = setup(),
      port = app.ports[0];
    app.session.start(app.input);
    const check = port.sent.at(-1)!;
    if (stage === "admission")
      port.receive({ id: check.id, type: "duplicates", token: randomUUID(), matches: [] });
    port.receive({
      id: stage === "preflight" ? check.id : app.input.id,
      type: "error",
      message: "Disk unavailable",
    });
    assert.equal(app.events.filter(event => event.type === "admitted").length, 0);
    assert.equal(app.state.checking, false);
    assert.equal(app.state.submitting, false);
    assert.ok(
      app.events.some(event => event.type === "error" && event.message === "Disk unavailable"),
    );
    app.session.dispose();
  }
});
