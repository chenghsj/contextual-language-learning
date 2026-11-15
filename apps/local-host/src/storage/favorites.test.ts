import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import { customFavoriteFixture } from "../../../../packages/core/test/custom-favorite-fixture";
import {
  customFavoriteTarget,
  type FavoriteCollection,
  type FavoriteRecord,
} from "@contextual/core";
import {
  createFavoritesService,
  favoriteBytes,
  favoriteCollectionId,
  favoriteKey,
  type FavoriteDrive,
  type RemoteFavorite,
} from "../favorites/service";

const local: FavoriteCollection = { kind: "local" };
const account: FavoriteCollection = { kind: "account", accountId: "test-account" };
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
class MemoryDrive implements FavoriteDrive {
  files = new Map<string, { account: string; collection: string; record: FavoriteRecord }>();
  uploads = 0;
  failAfterUpload = false;
  future = false;
  async reserve() {
    return randomUUID();
  }
  async list(owner: string, collection: string): Promise<RemoteFavorite[]> {
    return [...this.files]
      .filter(([, f]) => f.account === owner && f.collection === collection)
      .map(([id, f]) => ({
        id,
        operationId: f.record.operationId,
        hash: sha(favoriteBytes(f.record)),
        schema: this.future ? "2" : "1",
      }));
  }
  async read(_owner: string, _collection: string, file: RemoteFavorite) {
    return this.files.get(file.id)!.record;
  }
  async write(owner: string, collection: string, record: FavoriteRecord, id: string) {
    this.uploads++;
    this.files.set(id, { account: owner, collection, record: structuredClone(record) });
    if (this.failAfterUpload) {
      this.failAfterUpload = false;
      throw new Error("fetch failed after commit");
    }
  }
}
async function setup(drive = new MemoryDrive()) {
  const root = await mkdtemp(join(tmpdir(), "cll-favorites-test-"));
  const fixture = pointsFixture();
  let available = true;
  const loadDocument = async (id: string) =>
    available && id === fixture.document.id ? fixture.document : null;
  const service = createFavoritesService({ root, drive, loadDocument });
  const identity = { documentId: fixture.document.id, sceneId: fixture.document.sections[0].id };
  return {
    root,
    drive,
    service,
    identity,
    fixture,
    loadDocument,
    removeSource: () => {
      available = false;
    },
  };
}
test("durable no-op and old retries never revive a later cancellation, including after restart/source removal", async () => {
  const s = await setup();
  const add = { ...s.identity, collection: local, desired: true, mutationId: randomUUID() };
  await s.service.set(add);
  const noop = { ...add, mutationId: randomUUID() };
  await s.service.set(noop);
  await s.service.set({ ...add, desired: false, mutationId: randomUUID() });
  s.removeSource();
  const restarted = createFavoritesService({
    root: s.root,
    drive: s.drive,
    loadDocument: s.loadDocument,
  });
  assert.equal(await restarted.set(add), null);
  assert.equal(await restarted.set(noop), null);
  assert.equal((await restarted.list(local, { limit: 40 })).items.length, 0);
  const restored = await restarted.set({ ...add, mutationId: randomUUID() });
  assert.ok(restored);
  const reopened = await restarted.get(local, restored.key);
  assert.equal(reopened.snapshotVersion, 1);
  if (reopened.snapshotVersion !== 1) throw new Error("Expected scene snapshot");
  assert.equal(reopened.scene.title, s.fixture.document.sections[0].title);
  await assert.rejects(restarted.set({ ...add, desired: false }), /identity reused/);
});
test("independent services race one mutation without overwriting; corrupt history remains visible as partial", async () => {
  const s = await setup();
  const second = createFavoritesService({
    root: s.root,
    drive: s.drive,
    loadDocument: s.loadDocument,
  });
  const input = { ...s.identity, collection: local, desired: true, mutationId: randomUUID() };
  await Promise.all([s.service.set(input), second.set(input)]);
  assert.equal(
    (await readdir(join(s.root, "local", "operations"))).filter(f => f.endsWith(".json")).length,
    1,
  );
  await writeFile(
    join(s.root, "local", "operations", randomUUID() + ".json"),
    '{"schemaVersion":99}',
  );
  const list = await second.list(local, { limit: 40 });
  assert.equal(list.partial, true);
  assert.equal(list.items.length, 1);
  await assert.rejects(
    second.set({ ...input, desired: false, mutationId: randomUUID() }),
    /history cannot be read/,
  );
});
test("two real Host processes keep both writes and a later command observes the shared directory", async () => {
  const s = await setup();
  const script = join(s.root, "writer.mts");
  await writeFile(join(s.root, "document.json"), JSON.stringify(s.fixture.document));
  await writeFile(
    script,
    `import {createFavoritesService} from ${JSON.stringify(new URL("../favorites/service.ts", import.meta.url).href)};import {readFile} from "node:fs/promises";const document=JSON.parse(await readFile(process.argv[2]+"/document.json","utf8"));const service=createFavoritesService({root:process.argv[2],loadDocument:async()=>document,drive:{}});await service.set({collection:{kind:"local"},documentId:document.id,sceneId:document.sections[0].id,mutationId:process.argv[3],desired:process.argv[4]==="true"});`,
  );
  const run = (desired: boolean) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", script, s.root, randomUUID(), String(desired)],
        { cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"] },
      );
      let error = "";
      child.stderr.on("data", chunk => {
        error += chunk;
      });
      child.once("error", reject);
      child.once("exit", code => (code === 0 ? resolve() : reject(new Error(error))));
    });
  await Promise.all([run(true), run(false)]);
  assert.equal(
    (await readdir(join(s.root, "local", "operations"))).filter(f => f.endsWith(".json")).length,
    2,
  );
  await s.service.set({
    ...s.identity,
    collection: local,
    mutationId: randomUUID(),
    desired: true,
  });
  assert.equal(
    (await s.service.states(local, s.identity.documentId, [s.identity.sceneId]))[
      s.identity.sceneId
    ],
    true,
  );
});
test("two isolated stores converge after offline concurrent add/remove, then an observed re-add", async () => {
  const drive = new MemoryDrive(),
    a = await setup(drive),
    b = await setup(drive);
  for (const s of [a, b])
    await s.service.configure({
      kind: "enable",
      accountId: account.accountId,
      importLocal: false,
      mutationId: randomUUID(),
    });
  await a.service.set({
    ...a.identity,
    collection: account,
    desired: true,
    mutationId: randomUUID(),
  });
  assert.equal((await a.service.sync(account)).state, "synced");
  await b.service.sync(account);
  await a.service.set({
    ...a.identity,
    collection: account,
    desired: false,
    mutationId: randomUUID(),
  });
  await b.service.set({
    ...a.identity,
    collection: account,
    desired: true,
    mutationId: randomUUID(),
  });
  await b.service.sync(account);
  await a.service.sync(account);
  await b.service.sync(account);
  for (const s of [a, b])
    assert.equal((await s.service.list(account, { limit: 40 })).items.length, 0);
  await b.service.set({
    ...a.identity,
    collection: account,
    desired: true,
    mutationId: randomUUID(),
  });
  await b.service.sync(account);
  await a.service.sync(account);
  assert.equal((await a.service.list(account, { limit: 40 })).items.length, 1);
  assert.equal(
    (await a.service.list({ kind: "account", accountId: "different" }, { limit: 40 })).items.length,
    0,
  );
});
test("uncertain upload resumes from cloud without duplicates; unsupported formats never report synced", async () => {
  const s = await setup();
  await s.service.configure({
    kind: "enable",
    accountId: account.accountId,
    importLocal: false,
    mutationId: randomUUID(),
  });
  await s.service.set({
    ...s.identity,
    collection: account,
    desired: true,
    mutationId: randomUUID(),
  });
  s.drive.failAfterUpload = true;
  assert.equal((await s.service.sync(account)).state, "offline");
  const restarted = createFavoritesService({
    root: s.root,
    drive: s.drive,
    loadDocument: s.loadDocument,
  });
  assert.equal((await restarted.sync(account)).state, "synced");
  assert.equal(s.drive.uploads, 1);
  s.drive.future = true;
  assert.equal((await restarted.sync(account)).state, "partial");
});
test("import manifests resume exact selection and reenabling does not resurrect already imported local data", async () => {
  const s = await setup();
  await s.service.set({
    ...s.identity,
    collection: local,
    desired: true,
    mutationId: randomUUID(),
  });
  const enable = {
    kind: "enable" as const,
    accountId: account.accountId,
    importLocal: true,
    mutationId: randomUUID(),
  };
  await s.service.configure(enable);
  await s.service.set({
    ...s.identity,
    collection: account,
    desired: false,
    mutationId: randomUUID(),
  });
  await s.service.configure({
    kind: "disable",
    accountId: account.accountId,
    mutationId: randomUUID(),
  });
  await s.service.configure({ ...enable, mutationId: randomUUID() });
  assert.equal((await s.service.list(account, { limit: 40 })).items.length, 0);
  const files = await readdir(
    join(s.root, "accounts", favoriteCollectionId(account), "operations"),
  );
  assert.equal(files.filter(f => f.endsWith(".json")).length, 2);
  await s.service.configure(enable);
  assert.equal((await s.service.list(account, { limit: 40 })).items.length, 0);
});
test("stable pagination searches saved text and rejects changed-index cursors", async () => {
  const s = await setup();
  for (let index = 0; index < 3; index++) {
    const document = structuredClone(s.fixture.document);
    document.id = randomUUID();
    const service = createFavoritesService({
      root: s.root,
      drive: s.drive,
      loadDocument: async () => document,
    });
    await service.set({
      collection: local,
      documentId: document.id,
      sceneId: document.sections[0].id,
      desired: true,
      mutationId: randomUUID(),
    });
  }
  const first = await s.service.list(local, { limit: 1 });
  assert.ok(first.nextCursor);
  const second = await s.service.list(local, { limit: 1, cursor: first.nextCursor });
  assert.notEqual(first.items[0].key, second.items[0].key);
  const originalKey = favoriteKey(s.identity);
  assert.notEqual(first.items[0].key, originalKey);
  await s.service.set({
    ...s.identity,
    collection: local,
    desired: true,
    mutationId: randomUUID(),
  });
  await assert.rejects(
    s.service.list(local, { limit: 1, cursor: first.nextCursor }),
    /list changed/,
  );
});

test("sequential enable and disable in one millisecond follow committed sequence rather than UUID", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-20T00:00:00Z") });
  const s = await setup();
  await s.service.configure({
    kind: "enable",
    accountId: account.accountId,
    importLocal: false,
    mutationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  });
  const disabled = await s.service.configure({
    kind: "disable",
    accountId: account.accountId,
    mutationId: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(disabled.enabled, false);
  assert.equal((await s.service.sync(account)).state, "disabled");
  assert.equal(s.drive.uploads, 0);
});

test("known cloud records without a metadata checksum are read and verified again", async () => {
  const s = await setup();
  await s.service.configure({
    kind: "enable",
    accountId: account.accountId,
    importLocal: false,
    mutationId: randomUUID(),
  });
  await s.service.set({
    ...s.identity,
    collection: account,
    desired: true,
    mutationId: randomUUID(),
  });
  assert.equal((await s.service.sync(account)).state, "synced");
  const read = s.drive.read.bind(s.drive);
  s.drive.read = async (owner, collection, file) => ({
    ...(await read(owner, collection, file)),
    requestHash: "f".repeat(64),
  });
  assert.equal((await s.service.sync(account)).state, "partial");
});

test("an edit during an active sync reaches Drive before overlapping sync requests complete", async () => {
  const drive = new MemoryDrive();
  const s = await setup(drive);
  await s.service.configure({
    kind: "enable",
    accountId: account.accountId,
    importLocal: false,
    mutationId: randomUUID(),
  });
  await s.service.set({
    ...s.identity,
    collection: account,
    desired: true,
    mutationId: randomUUID(),
  });
  const originalWrite = drive.write.bind(drive);
  let acknowledgeBlocked = () => {};
  let releaseUpload = () => {};
  const blocked = new Promise<void>(resolve => {
    acknowledgeBlocked = resolve;
  });
  const release = new Promise<void>(resolve => {
    releaseUpload = resolve;
  });
  let first = true;
  drive.write = async (...args) => {
    if (first) {
      first = false;
      acknowledgeBlocked();
      await release;
    }
    await originalWrite(...args);
  };
  const initial = s.service.sync(account);
  await blocked;
  await s.service.set({
    ...s.identity,
    collection: account,
    desired: false,
    mutationId: randomUUID(),
  });
  const overlapping = s.service.sync(account);
  releaseUpload();
  const results = await Promise.all([initial, overlapping]);
  assert.deepEqual(
    results.map(result => result.state),
    ["synced", "synced"],
  );
  const second = await setup(drive);
  await second.service.configure({
    kind: "enable",
    accountId: account.accountId,
    importLocal: false,
    mutationId: randomUUID(),
  });
  await second.service.sync(account);
  assert.equal((await second.service.list(account, { limit: 40 })).items.length, 0);
});

test("custom Markdown favorites coexist with scenes and sync complete snapshots to a source-free device", async () => {
  const s = await setup();
  const custom = customFavoriteFixture();
  custom.markdown += "\n" + "內容 ".repeat(250) + "searchable-tail";
  const originalMarkdown = custom.markdown;
  let available = true;
  const service = createFavoritesService({
    root: s.root,
    drive: s.drive,
    loadDocument: s.loadDocument,
    loadCustomDocument: async id => (available && id === custom.id ? custom : null),
  });
  const input = {
    ...customFavoriteTarget(custom.id),
    collection: local,
    desired: true,
    mutationId: randomUUID(),
  };
  const saved = await service.set(input);
  assert.ok(saved);
  assert.equal(saved.kind, "custom");
  assert.equal(saved.language, "unspecified");
  await service.set({ ...s.identity, collection: local, desired: true, mutationId: randomUUID() });
  assert.equal((await service.list(local, { limit: 40 })).items.length, 2);
  assert.equal(
    (await service.list(local, { search: "searchable-tail", limit: 40 })).items[0].key,
    saved.key,
  );
  assert.deepEqual(
    (await service.list(local, { language: "unspecified", limit: 40 })).items.map(i => i.key),
    [saved.key],
  );
  custom.title = "Renamed source";
  custom.markdown = "Changed source";
  available = false;
  await service.configure({
    kind: "enable",
    accountId: account.accountId,
    importLocal: true,
    mutationId: randomUUID(),
  });
  await service.sync(account);
  const root = await mkdtemp(join(tmpdir(), "cll-custom-favorite-second-"));
  const second = createFavoritesService({ root, drive: s.drive, loadDocument: async () => null });
  await second.configure({
    kind: "enable",
    accountId: account.accountId,
    importLocal: false,
    mutationId: randomUUID(),
  });
  await second.sync(account);
  const page = await second.list(account, { limit: 40 });
  assert.equal(page.partial, false);
  assert.equal(page.items.length, 2);
  const reopened = await second.get(account, saved.key);
  assert.equal(reopened.snapshotVersion, 2);
  if (reopened.snapshotVersion !== 2) throw new Error("Expected custom snapshot");
  assert.equal(reopened.document.markdown, originalMarkdown);
  assert.notEqual(reopened.document.title, custom.title);
  const remove = { ...input, collection: account, desired: false, mutationId: randomUUID() };
  await second.set(remove);
  await second.sync(account);
  await service.sync(account);
  assert.equal(
    (await service.list(account, { language: "unspecified", limit: 40 })).items.length,
    0,
  );
  const restarted = createFavoritesService({
    root,
    drive: s.drive,
    loadDocument: async () => null,
  });
  const restored = await restarted.set({ ...remove, desired: true, mutationId: randomUUID() });
  assert.ok(restored);
  assert.equal((await restarted.get(account, restored.key)).snapshotVersion, 2);
  assert.deepEqual(
    await restarted.set(remove),
    restored,
    "old cancellation returns current confirmed membership",
  );
});
