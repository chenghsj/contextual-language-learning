import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { document } from "../../dev/reader-fixture";
import { getDocument, getJobPreview, request } from "./host-client";
import { testRuntime } from "./test-runtime";
test("a partial reader binds metadata to the document and requires explicit preview info", async () => {
  const app = testRuntime(),
    pending = getJobPreview(document.id, app.runtime),
    port = app.ports[0];
  const id = port.sent[0].id;
  port.receive({
    id,
    type: "job",
    job: {
      id: document.id,
      sourceTitle: "Preview",
      provider: "openai",
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
      completed: 1,
      total: 4,
      previewRevision: 2,
      selectedSceneCount: 4,
      readySceneIds: document.sections.map(s => s.id),
      status: "running",
    },
  });
  assert.equal(port.closed, false);
  port.receive({ id, type: "result", document });
  assert.equal((await pending).info.revision, 2);
  assert.equal(port.closed, true);
  const invalid = getJobPreview(document.id, app.runtime),
    other = app.ports[1];
  other.receive({ id: other.sent[0].id, type: "result", document });
  await assert.rejects(invalid, /revision/);
});

test("typed requests filter IDs, use declared replies and close after success or failure", async () => {
  const app = testRuntime();
  const jobs = request({ type: "listJobs" }, app.runtime);
  const port = app.ports[0];
  port.receive({ id: randomUUID(), type: "jobs", jobs: [] });
  assert.equal(port.closed, false);
  port.receive({ id: port.sent[0].id, type: "jobs", jobs: [] });
  assert.deepEqual((await jobs).jobs, []);
  assert.equal(port.closed, true);

  const logout = request({ type: "piLogout", provider: "openai" }, app.runtime);
  const auth = app.ports[1];
  auth.receive({ id: auth.sent[0].id, type: "piProviders", providers: [] });
  assert.deepEqual((await logout).providers, []);

  const publication = request({ type: "publishJob", jobId: document.id }, app.runtime);
  const failed = app.ports[2];
  failed.receive({
    id: failed.sent[0].id,
    type: "publicationFailed",
    jobId: document.id,
    message: "External edit",
  });
  await assert.rejects(publication, /External edit/);
  assert.equal(failed.closed, true);

  const invalid = request({ type: "listLessons" }, app.runtime);
  app.ports[3].receive({ type: "lessons", lessons: "invalid" });
  await assert.rejects(invalid, /invalid response/);
  assert.equal(app.ports[3].closed, true);
});

test("document request assembles UTF-8 chunks, rejects missing chunks and cleans disconnects", async () => {
  const app = testRuntime();
  const result = getDocument(document.id, app.runtime);
  const port = app.ports[0];
  const bytes = Buffer.from(JSON.stringify(document));
  const middle = Math.floor(bytes.length / 2);
  for (const [index, data] of [bytes.subarray(0, middle), bytes.subarray(middle)].entries()) {
    port.receive({
      type: "documentChunk",
      id: port.sent[0].id,
      documentId: document.id,
      index,
      total: 2,
      dataBase64: data.toString("base64"),
    });
  }
  assert.deepEqual(await result, document);
  assert.equal(port.closed, true);
  const missing = getDocument(document.id, app.runtime);
  const incomplete = app.ports[1];
  incomplete.receive({
    type: "documentChunk",
    id: incomplete.sent[0].id,
    documentId: document.id,
    index: 1,
    total: 2,
    dataBase64: bytes.toString("base64"),
  });
  await assert.rejects(missing, /Missing document chunks/);
  assert.equal(incomplete.closed, true);
  const interrupted = request({ type: "health" }, app.runtime);
  app.ports[2].disconnect();
  await assert.rejects(interrupted, /connection ended/);
});

test("opening a folder sends the current destination, waits for acknowledgement and reports Host failures", async () => {
  const app = testRuntime();
  for (const directory of [undefined, "/selected lessons"]) {
    const opened = request({ type: "openFolder", directory }, app.runtime);
    const port = app.ports.at(-1)!;
    assert.equal(port.sent[0].type, "openFolder");
    assert.equal(port.sent[0].directory, directory);
    port.receive({ id: port.sent[0].id, type: "folderOpened", directory: directory ?? "/default" });
    assert.equal((await opened).directory, directory ?? "/default");
    assert.equal(port.closed, true);
  }
  const failed = request({ type: "openFolder", directory: "/missing" }, app.runtime);
  const port = app.ports.at(-1)!;
  port.receive({ id: port.sent[0].id, type: "error", message: "Folder no longer exists" });
  await assert.rejects(failed, /Folder no longer exists/);
  assert.equal(port.closed, true);
});
