import test from "node:test";
import assert from "node:assert/strict";
import { document } from "../../dev/reader-fixture";
import { createPreviewSession } from "./preview-session";
import type { JobPreviewInfo } from "./host-client";
import type { JobSummary } from "@contextual/core";
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const info = (revision: number, status: JobPreviewInfo["status"] = "running"): JobPreviewInfo => ({
  jobId: document.id,
  revision,
  status,
  readySceneIds: document.sections.map(s => s.id),
  selectedSceneCount: document.sections.length,
});
const summary = (revision: number): JobSummary => ({
  id: document.id,
  sourceTitle: "Test",
  provider: "openai",
  status: "running",
  completed: 1,
  total: 4,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  previewRevision: revision,
});
test("preview revisions coalesce in-flight notifications and settle on completion", async () => {
  const pending: ((value: { info: JobPreviewInfo; document: typeof document }) => void)[] = [],
    seen: number[] = [];
  const session = createPreviewSession({
    load: () => new Promise(resolve => pending.push(resolve)),
    onSnapshot: s => seen.push(s.info.revision),
    onError: e => {
      throw e;
    },
  });
  session.open(document.id);
  session.update(summary(2));
  session.update(summary(3));
  assert.equal(pending.length, 1);
  pending[0]({ info: info(1), document });
  await tick();
  assert.deepEqual(seen, [1]);
  assert.equal(pending.length, 2);
  pending[1]({ info: info(3, "completed"), document });
  await tick();
  session.update(summary(4));
  assert.deepEqual(seen, [1, 3]);
  assert.equal(pending.length, 2);
});
test("abandoned readers ignore late responses and a failed request does not loop", async () => {
  let resolveOld!: (value: { info: JobPreviewInfo; document: typeof document }) => void;
  let calls = 0,
    seen = 0,
    errors = 0;
  const session = createPreviewSession({
    load: () => {
      calls++;
      return new Promise(resolve => {
        resolveOld = resolve;
      });
    },
    onSnapshot: () => seen++,
    onError: () => errors++,
  });
  session.open(document.id);
  session.close();
  resolveOld({ info: info(1), document });
  await tick();
  assert.equal(seen, 0);
  const failing = createPreviewSession({
    load: async () => {
      calls++;
      throw new Error("Disconnected");
    },
    onSnapshot: () => seen++,
    onError: () => errors++,
  });
  failing.open(document.id);
  failing.update(summary(3));
  await tick();
  await tick();
  assert.equal(calls, 2);
  assert.equal(errors, 1);
  assert.equal(seen, 0);
  failing.update(summary(3));
  await tick();
  assert.equal(calls, 2, "identical progress notifications must not retry a failed revision");
  failing.reconnect();
  await tick();
  assert.equal(calls, 3, "a real reconnect can retry once");
});
