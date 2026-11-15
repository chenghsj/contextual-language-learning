import test from "node:test";
import assert from "node:assert/strict";
import {
  DriveLibraryRepository,
  libraryContentKey,
  legacyLibraryContentKey,
  type LibraryCache,
  type LibraryCatalog,
  type LibraryDocument,
} from "./library";
import { libraryFixture } from "./library-fixture";
class MemoryLibraryCache implements LibraryCache {
  indexes = new Map<string, LibraryCatalog>();
  docs = new Map<string, LibraryDocument>();
  async libraryDocumentKeys(account: string) {
    return [...this.docs.keys()]
      .filter(key => key.startsWith(account))
      .map(key => key.slice(account.length));
  }
  async libraryCatalog(account: string) {
    return this.indexes.get(account);
  }
  async saveLibraryCatalog(account: string, value: LibraryCatalog, valid: () => boolean) {
    if (valid()) this.indexes.set(account, value);
  }
  async libraryDocument(account: string, key: string) {
    return this.docs.get(account + key);
  }
  async saveLibraryDocument(
    account: string,
    key: string,
    value: LibraryDocument,
    valid: () => boolean,
  ) {
    if (valid()) this.docs.set(account + key, value);
  }
}
test("library lists all backed-up material kinds using metadata and reads content only when opened", async () => {
  const f = await libraryFixture(),
    cache = new MemoryLibraryCache(),
    repo = new DriveLibraryRepository("account", f.drive, cache);
  await repo.refresh();
  assert.equal(repo.list().length, 2);
  assert.deepEqual(f.reads, []);
  for (const item of repo.list()) {
    const content = await repo.get(item);
    if (item.kind === "custom") {
      assert.equal(content.kind, "markdown");
      if (content.kind === "markdown") assert.equal(content.markdown, f.custom.markdown);
    } else if (item.schema === "7") {
      assert.equal(content.kind, "standard");
      if (content.kind === "standard")
        assert.equal(content.document.sections.length, f.document.sections.length);
    } else {
      assert.equal(content.kind, "markdown");
      if (content.kind === "markdown") assert.match(content.markdown, /舊版本仍然可以閱讀/);
    }
  }
  const offline = new DriveLibraryRepository("account", null, cache);
  await offline.hydrate();
  const reads = f.reads.length;
  await offline.get(offline.list()[0]);
  assert.equal(f.reads.length, reads);
  const other = new DriveLibraryRepository("other-account", null, cache);
  await other.hydrate();
  assert.equal(other.list().length, 0);
});
test("a failed refresh preserves the last complete library and corrupted content is rejected", async () => {
  const f = await libraryFixture(),
    cache = new MemoryLibraryCache(),
    repo = new DriveLibraryRepository("account", f.drive, cache);
  await repo.refresh();
  f.setFailure(true);
  await assert.rejects(repo.refresh(), /讀取失敗/);
  assert.equal(repo.list().length, 2);
  f.bodies.set("custom-md", new TextEncoder().encode("tampered"));
  await assert.rejects(repo.get(repo.list().find(item => item.kind === "custom")!), /校驗失敗/);
  assert.equal(cache.docs.size, 0);
});
test("an incomplete custom backup stays listed and cannot replace valid content", async () => {
  const f = await libraryFixture();
  f.files.splice(
    f.files.findIndex(file => file.id === "custom-md"),
    1,
  );
  const repo = new DriveLibraryRepository("account", f.drive, new MemoryLibraryCache());
  await repo.refresh();
  assert.equal(repo.list().length, 2);
  await assert.rejects(repo.get(repo.list().find(item => item.kind === "custom")!), /尚未完整/);
  assert.equal((await repo.get(repo.list().find(item => item.schema === "7")!)).kind, "standard");
});
test("logout during material download cannot repopulate the cache", async () => {
  const f = await libraryFixture(),
    cache = new MemoryLibraryCache();
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  const repo = new DriveLibraryRepository(
    "account",
    {
      ...f.drive,
      async readLibrary(file, max) {
        await gate;
        return f.drive.readLibrary(file, max);
      },
    },
    cache,
  );
  await repo.refresh();
  const reading = repo.get(repo.list().find(item => item.schema === "7")!);
  await new Promise(resolve => setTimeout(resolve, 5));
  repo.dispose();
  release();
  await assert.rejects(reading, /Aborted/);
  assert.equal(cache.docs.size, 0);
});

test("conflicting duplicates block only their own material and persist across offline reopen", async () => {
  const f = await libraryFixture(),
    cache = new MemoryLibraryCache();
  const source = f.files.find(file => file.id === "standard-json")!;
  f.files.push({ ...source, id: "duplicate-json" });
  const repo = new DriveLibraryRepository("account", f.drive, cache);
  await repo.refresh();
  assert.equal(repo.list().length, 2);
  assert.equal(repo.list().find(item => item.schema === "7")?.conflict, true);
  await assert.rejects(repo.get(repo.list().find(item => item.schema === "7")!), /重複/);
  assert.equal(
    (await repo.get(repo.list().find(item => item.kind === "custom")!)).kind,
    "markdown",
  );
  const offline = new DriveLibraryRepository("account", null, cache);
  await offline.hydrate();
  await assert.rejects(offline.get(offline.list().find(item => item.schema === "7")!), /重複/);
});

test("retired standard JSON and Markdown backups are omitted without downloading their contents", async () => {
  const f = await libraryFixture(),
    repo = new DriveLibraryRepository("account", f.drive, new MemoryLibraryCache());
  await repo.refresh();
  assert.equal(repo.list().length, 2);
  assert.ok(repo.list().every(item => item.kind === "custom" || item.schema === "7"));
  assert.deepEqual(f.reads, []);
});

test("Drive metadata property order changes do not lose downloaded lessons; content changes invalidate them", async () => {
  const f = await libraryFixture(),
    cache = new MemoryLibraryCache();
  const repo = new DriveLibraryRepository("account", f.drive, cache);
  await repo.refresh();
  for (const item of repo.list()) await repo.get(item);
  const reads = f.reads.length;
  for (const file of f.files)
    file.appProperties = Object.fromEntries(Object.entries(file.appProperties).reverse());
  await repo.refresh();
  const offline = new DriveLibraryRepository("account", null, cache);
  await offline.hydrate();
  for (const item of offline.list()) await offline.get(item);
  assert.equal(
    f.reads.length,
    reads,
    "the same downloaded content opens without authorization after fresh metadata",
  );
  f.files.find(file => file.id === "custom-md")!.appProperties.contextualContentHash = "f".repeat(
    64,
  );
  await repo.refresh();
  const changed = new DriveLibraryRepository("account", null, cache);
  await changed.hydrate();
  await assert.rejects(
    changed.get(changed.list().find(item => item.kind === "custom")!),
    /需要連線/,
  );
});

test("matching old cache keys migrate on offline open without a new Drive authorization", async () => {
  const f = await libraryFixture(),
    cache = new MemoryLibraryCache();
  const repo = new DriveLibraryRepository("account", f.drive, cache);
  await repo.refresh();
  const item = repo.list().find(item => item.kind === "standard")!;
  const content = await repo.get(item);
  const current = await libraryContentKey(item),
    legacy = await legacyLibraryContentKey(item);
  cache.docs.delete("account" + current);
  cache.docs.set("account" + legacy, content);
  const reads = f.reads.length;
  const offline = new DriveLibraryRepository("account", null, cache);
  await offline.hydrate();
  assert.equal((await offline.get(item)).kind, "standard");
  assert.ok(cache.docs.has("account" + current));
  assert.equal(f.reads.length, reads);
});
