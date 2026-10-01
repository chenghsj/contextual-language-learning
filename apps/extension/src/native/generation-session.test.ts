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

test("late chunk recovery delivers after settlement, but a newer job suppresses its stale result", async () => {
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
    assert.equal(app.events.filter(event => event.type === "document").length, superseded ? 0 : 1);
    app.session.dispose();
  }
});
