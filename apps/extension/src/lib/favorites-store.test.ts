import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { FavoriteSetSchema } from "@contextual/core";
import { document } from "../../dev/reader-fixture";
import { testRuntime } from "../native/test-runtime";
import { FavoritesStore, favoriteStateKey } from "./favorites-store";

function setup(saved: Record<string, unknown> = {}) {
  const app = testRuntime();
  Object.assign(globalThis, { chrome: { runtime: app.runtime } });
  const storage = {
    get: async () => saved,
    set: async (values: Record<string, unknown>) => {
      Object.assign(saved, structuredClone(values));
    },
  };
  return { ...app, storage, saved, store: new FavoritesStore(storage) };
}
const sceneId = document.sections[0].id;
const key = favoriteStateKey(document.id, sceneId);
const local = { kind: "local" } as const;

test("a sync-created ready broadcast preserves its result and never starts a polling chain", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const collection = { kind: "account", accountId: "account-b" } as const;
  const app = setup({ favoriteCollectionV1: collection });
  const disconnect = app.store.connect();
  await setImmediate();
  const watcher = app.ports[0];
  const initial = app.ports[1];
  initial.receive({
    id: initial.sent[0].id,
    type: "favoriteStatus",
    status: { collection, enabled: true, state: "synced", pending: 0 },
  });
  await setImmediate();
  context.mock.timers.tick(600);
  const sync = app.ports[2];
  assert.equal(sync.sent[0].type, "syncFavorites");
  watcher.receive({
    type: "generationState",
    active: null,
    connection: { status: "ready", attempt: 0 },
  });
  await setImmediate();
  assert.equal(app.ports.length, 3, "routine ready does not issue a status query during sync");
  sync.receive({
    id: sync.sent[0].id,
    type: "favoriteStatus",
    status: { collection, enabled: true, state: "partial", pending: 3 },
  });
  await setImmediate();
  assert.equal(app.store.getSnapshot().status?.state, "partial");
  assert.equal(app.store.getSnapshot().status?.pending, 3);
  watcher.receive({
    type: "generationState",
    active: null,
    connection: { status: "ready", attempt: 0 },
  });
  context.mock.timers.tick(5000);
  await setImmediate();
  assert.equal(app.ports.length, 3, "sync completion schedules no later cloud request");
  disconnect();
});

test("Host confirmation remains authoritative when retry cleanup storage fails", async () => {
  const app = setup();
  const write = app.storage.set;
  let writes = 0;
  app.storage.set = values =>
    ++writes === 2 ? Promise.reject(new Error("Storage unavailable")) : write(values);
  const mutation = app.store.set(document.id, sceneId, true);
  await setImmediate();
  const port = app.ports[0];
  port.receive({ id: port.sent[0].id, type: "favoriteChanged", collection: local, favorite: null });
  assert.equal(await mutation, false, "replayed mutations report current reduced Host state");
  assert.equal(app.store.getSnapshot().states[key], false);
  assert.equal(app.store.getSnapshot().error, null);
  assert.ok(
    Array.isArray(app.saved.favoriteRetriesV1),
    "a retained durable command can safely be replayed",
  );
});

test("configure retries preserve identity and disabling keeps the account collection", async () => {
  const collection = { kind: "account", accountId: "account-b" } as const;
  const app = setup({ favoriteCollectionV1: collection });
  const first = app.store.configure({ kind: "disable", accountId: collection.accountId });
  await setImmediate();
  const failed = app.ports[0];
  failed.receive({ id: failed.sent[0].id, type: "error", message: "Disconnected" });
  await assert.rejects(first, /Disconnected/);
  const store = new FavoritesStore(app.storage);
  const retry = store.configure({ kind: "disable", accountId: collection.accountId });
  await setImmediate();
  const port = app.ports[1];
  assert.deepEqual(port.sent[0].change, failed.sent[0].change);
  port.receive({
    id: port.sent[0].id,
    type: "favoriteStatus",
    status: { collection, enabled: false, state: "disabled", pending: 0 },
  });
  await retry;
  assert.deepEqual(store.getSnapshot().collection, collection);
  assert.equal(store.getSnapshot().status?.enabled, false);
});

test("pagination appends results and stale searches cannot replace the current page", async () => {
  const app = setup();
  await app.store.load();
  const item = {
    key: "1".repeat(64),
    documentId: document.id,
    sceneId,
    title: "Saved scene",
    sourceTitle: document.source.title,
    language: "en",
    excerpt: "Hello",
    savedAt: document.createdAt,
    pending: false,
  };
  const first = app.store.list({ limit: 40 });
  app.ports[0].receive({
    id: app.ports[0].sent[0].id,
    type: "favorites",
    collection: local,
    page: { items: [item], nextCursor: "page-two", partial: false },
  });
  await first;
  const next = app.store.list({ limit: 40, cursor: "page-two" }, true);
  app.ports[1].receive({
    id: app.ports[1].sent[0].id,
    type: "favorites",
    collection: local,
    page: { items: [{ ...item, key: "2".repeat(64) }], partial: true },
  });
  await next;
  assert.equal(app.store.getSnapshot().page?.items.length, 2);
  assert.equal(app.store.getSnapshot().page?.partial, true);
  const old = app.store.list({ limit: 40, search: "old" });
  const current = app.store.list({ limit: 40, search: "current" });
  app.ports[3].receive({
    id: app.ports[3].sent[0].id,
    type: "favorites",
    collection: local,
    page: { items: [], partial: false },
  });
  await current;
  app.ports[2].receive({
    id: app.ports[2].sent[0].id,
    type: "favorites",
    collection: local,
    page: { items: [item], partial: false },
  });
  await old;
  assert.deepEqual(app.store.getSnapshot().page?.items, []);
});

test("favorite membership uses batch states, confirms changes and rolls back failure with durable retry identity", async () => {
  const app = setup();
  const tracking = app.store.track(document.id, [sceneId]);
  await setImmediate();
  const states = app.ports[0];
  assert.deepEqual(states.sent[0].sceneIds, [sceneId]);
  states.receive({
    id: states.sent[0].id,
    type: "favoriteStates",
    collection: local,
    states: { [sceneId]: true },
  });
  await tracking;
  const mutation = app.store.set(document.id, sceneId, false);
  await setImmediate();
  const failed = app.ports[1];
  const first = FavoriteSetSchema.parse(failed.sent[0].input);
  assert.equal(app.store.getSnapshot().states[key], true);
  assert.equal(app.store.getSnapshot().pending.has(key), true);
  failed.receive({ id: failed.sent[0].id, type: "error", message: "Disk full" });
  await assert.rejects(mutation, /Disk full/);
  assert.equal(app.store.getSnapshot().states[key], true);
  assert.equal(app.store.getSnapshot().pending.has(key), false);
  const reopened = new FavoritesStore(app.storage);
  const retried = reopened.set(document.id, sceneId, false);
  await setImmediate();
  const retry = app.ports[2];
  const second = FavoriteSetSchema.parse(retry.sent[0].input);
  assert.equal(second.mutationId, first.mutationId);
  retry.receive({
    id: retry.sent[0].id,
    type: "favoriteChanged",
    collection: local,
    favorite: null,
  });
  await retried;
  assert.equal(reopened.getSnapshot().states[key], false);
  assert.deepEqual(app.saved.favoriteRetriesV1, []);
});

test("late membership replies cannot overwrite another collection", async () => {
  const app = setup();
  const tracking = app.store.track(document.id, [sceneId]);
  await setImmediate();
  const old = app.ports[0];
  const selected = app.store.select({ kind: "account", accountId: "account-b" });
  await setImmediate();
  const current = app.ports.find(port => port.sent[0].type === "favoriteStates" && port !== old)!;
  current.receive({
    id: current.sent[0].id,
    type: "favoriteStates",
    collection: { kind: "account", accountId: "account-b" },
    states: { [sceneId]: false },
  });
  const status = app.ports.find(port => port.sent[0].type === "favoriteStatus")!;
  status.receive({
    id: status.sent[0].id,
    type: "favoriteStatus",
    status: {
      collection: { kind: "account", accountId: "account-b" },
      enabled: false,
      state: "disabled",
      pending: 0,
    },
  });
  await selected;
  old.receive({
    id: old.sent[0].id,
    type: "favoriteStates",
    collection: local,
    states: { [sceneId]: true },
  });
  await tracking;
  assert.equal(app.store.getSnapshot().states[key], false);
  assert.deepEqual(app.saved.favoriteCollectionV1, { kind: "account", accountId: "account-b" });
});

test("a late batch response cannot undo a confirmed mutation", async () => {
  const app = setup();
  const tracking = app.store.track(document.id, [sceneId]);
  await setImmediate();
  const old = app.ports[0];
  const mutation = app.store.set(document.id, sceneId, false);
  await setImmediate();
  const changed = app.ports[1];
  changed.receive({
    id: changed.sent[0].id,
    type: "favoriteChanged",
    collection: local,
    favorite: null,
  });
  await mutation;
  old.receive({
    id: old.sent[0].id,
    type: "favoriteStates",
    collection: local,
    states: { [sceneId]: true },
  });
  await tracking;
  assert.equal(app.store.getSnapshot().states[key], false);
});

const savedScene = {
  key: "1".repeat(64),
  documentId: document.id,
  sceneId,
  title: "Saved scene",
  sourceTitle: document.source.title,
  language: "en",
  excerpt: "Hello",
  savedAt: document.createdAt,
  pending: false,
};

test("reenabling sync retains the account list and schedules its upload", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const collection = { kind: "account", accountId: "account-b" } as const;
  const app = setup({ favoriteCollectionV1: collection });
  await app.store.load();
  const listing = app.store.list();
  app.ports[0].receive({
    id: app.ports[0].sent[0].id,
    type: "favorites",
    collection,
    page: { items: [savedScene], partial: false },
  });
  await listing;
  const visibleCounts: number[] = [];
  const unsubscribe = app.store.subscribe(() =>
    visibleCounts.push(app.store.getSnapshot().page?.items.length ?? 0),
  );
  const enabled = app.store.configure({
    kind: "enable",
    accountId: collection.accountId,
    importLocal: true,
  });
  await setImmediate();
  const configure = app.ports[1];
  configure.receive({
    id: configure.sent[0].id,
    type: "favoriteStatus",
    status: { collection, enabled: true, state: "pending", pending: 1 },
  });
  await enabled;
  assert.ok(
    visibleCounts.length > 0 && visibleCounts.every(count => count === 1),
    "toggling sync does not clear or replace the current list",
  );
  assert.equal(app.store.getSnapshot().status?.enabled, true);
  context.mock.timers.tick(600);
  const sync = app.ports[2];
  assert.equal(sync.sent[0].type, "syncFavorites");
  sync.receive({
    id: sync.sent[0].id,
    type: "favoriteStatus",
    status: { collection, enabled: true, state: "synced", pending: 0 },
  });
  await setImmediate();
  unsubscribe();
});

test("a failed first enable retains local favorites and reuses the configuration identity", async () => {
  const app = setup();
  await app.store.load();
  const listing = app.store.list();
  app.ports[0].receive({
    id: app.ports[0].sent[0].id,
    type: "favorites",
    collection: local,
    page: { items: [savedScene], partial: false },
  });
  await listing;
  const first = app.store.configure({ kind: "enable", accountId: "account-b", importLocal: true });
  await setImmediate();
  const failed = app.ports[1];
  failed.receive({ id: failed.sent[0].id, type: "error", message: "Disconnected" });
  await assert.rejects(first, /Disconnected/);
  assert.deepEqual(app.store.getSnapshot().page?.items, [savedScene]);
  assert.deepEqual(app.store.getSnapshot().collection, local);
  const retry = app.store.configure({ kind: "enable", accountId: "account-b", importLocal: true });
  await setImmediate();
  const repeated = app.ports[2];
  assert.deepEqual(repeated.sent[0].change, failed.sent[0].change);
  repeated.receive({ id: repeated.sent[0].id, type: "error", message: "Disconnected" });
  await assert.rejects(retry, /Disconnected/);
  assert.deepEqual(app.store.getSnapshot().page?.items, [savedScene]);
});
