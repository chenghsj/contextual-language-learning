import assert from "node:assert/strict";
import test from "node:test";
import { createDriveAuthorizationTabs, type AuthorizationTabs } from "./drive-authorization-tabs";

function setup() {
  const listeners: ((id: number) => void)[] = [];
  const opened: { url: string; active: boolean }[] = [],
    cancelled: string[] = [],
    removed: number[] = [];
  const tabs = {
    onRemoved: { addListener: (listener: (id: number) => void) => listeners.push(listener) },
    create: async (options: { url: string; active: boolean }) => {
      opened.push(options);
      return { id: opened.length };
    },
    remove: async (id: number) => {
      removed.push(id);
    },
  } as unknown as AuthorizationTabs;
  return {
    opened,
    cancelled,
    removed,
    close: (id: number) => listeners.forEach(fn => fn(id)),
    tracker: createDriveAuthorizationTabs(tabs, id => cancelled.push(id)),
  };
}
const url = "https://accounts.google.com/o/oauth2/v2/auth?state=synthetic";
test("closing one Google tab cancels only its login, once, without touching other tabs", async () => {
  const app = setup();
  app.tracker.start("first", url);
  app.tracker.start("second", url);
  await Promise.resolve();
  app.close(999);
  assert.deepEqual(app.cancelled, []);
  app.close(1);
  app.close(1);
  assert.deepEqual(app.cancelled, ["first"]);
  app.tracker.finish("second");
  app.close(2);
  assert.deepEqual(app.cancelled, ["first"], "closing the callback after completion is harmless");
});
test("no usable Google tab or an invalid origin cancels without opening arbitrary sites", () => {
  const app = setup();
  app.tracker.start("bad", "https://example.test/o/oauth2/v2/auth");
  assert.deepEqual(app.opened, []);
  assert.deepEqual(app.cancelled, ["bad"]);
  const cancelled: string[] = [];
  createDriveAuthorizationTabs(undefined, id => cancelled.push(id)).start("missing", url);
  assert.deepEqual(cancelled, ["missing"]);
});
test("panel closure before tab creation resolves cannot leave a live abandoned login tab", async () => {
  const app = setup();
  app.tracker.start("late", url);
  app.tracker.finish("late");
  await Promise.resolve();
  assert.deepEqual(app.removed, [1]);
});
