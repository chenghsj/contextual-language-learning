import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostRequestSchema, type FavoriteCollection, type HostMessage } from "@contextual/core";
import { customFavoriteFixture } from "../../../../packages/core/test/custom-favorite-fixture";
import { completedLesson } from "./test-fixtures";
import { localStoragePorts } from "./file";
import { FileCustomRepository } from "./custom";
import { createDocumentSync } from "./document-sync";
import { serializeDocument } from "./document-queue";
import { findVideoDocument } from "./video-folders";
import { createFavoritesService, type FavoriteDrive } from "../favorites/service";
import { handleLessonRequest } from "../host/lessons";
import { createCustomHandler } from "../host/custom";

test("local deletion validates IDs and preserves favorites, sibling lessons, exports and task history after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-library-delete-"));
  try {
    const data = join(root, "data");
    const { storage, document } = await completedLesson(data);
    const sibling = (await completedLesson(data)).document;
    const custom = new FileCustomRepository(join(root, "custom"));
    const notes = customFavoriteFixture();
    await custom.saveDocument(notes);
    const exported = join(root, "export.md");
    await writeFile(exported, "User-edited export");
    const path = (await findVideoDocument(data, document.id))!;
    const drive: FavoriteDrive = {
      async list() {
        throw new Error("Unexpected Drive access");
      },
      async read() {
        throw new Error("Unexpected Drive access");
      },
      async reserve() {
        throw new Error("Unexpected Drive access");
      },
      async write() {
        throw new Error("Unexpected Drive access");
      },
    };
    const openFavorites = () =>
      createFavoritesService({
        root: join(root, "favorites"),
        drive,
        loadDocument: id => storage.documents.get(id),
        loadCustomDocument: id => custom.getDocument(id),
      });
    const collections: FavoriteCollection[] = [
      { kind: "local" },
      { kind: "account", accountId: "offline-account" },
    ];
    const favorites = openFavorites();
    for (const collection of collections) {
      await favorites.set({
        collection,
        documentId: document.id,
        sceneId: document.sections[0].id,
        desired: true,
        mutationId: randomUUID(),
      });
      await favorites.set({
        collection,
        documentId: notes.id,
        sceneId: notes.id,
        desired: true,
        mutationId: randomUUID(),
      });
    }
    assert.equal(
      HostRequestSchema.safeParse({
        id: randomUUID(),
        type: "deleteLocalLesson",
        documentId: "../../elsewhere",
      }).success,
      false,
    );
    const messages: HostMessage[] = [];
    const request = HostRequestSchema.parse({
      id: randomUUID(),
      type: "deleteLocalLesson",
      documentId: document.id,
    });
    assert.equal(
      await handleLessonRequest(
        request,
        { storage, manager: null as never, reply: message => messages.push(message) },
        () => assert.fail("Unexpected document delivery"),
      ),
      true,
    );
    assert.deepEqual(messages[0], {
      id: request.id,
      type: "localLessonDeleted",
      documentId: document.id,
    });
    await createCustomHandler(custom, null as never, message => messages.push(message))({
      id: randomUUID(),
      type: "deleteCustomDocument",
      documentId: notes.id,
    });
    assert.equal(messages[1].type, "customDocumentChanged");
    const restarted = localStoragePorts(data);
    assert.equal(await restarted.documents.get(document.id), null);
    assert.equal(await new FileCustomRepository(join(root, "custom")).getDocument(notes.id), null);
    await assert.rejects(access(path), { code: "ENOENT" });
    await assert.rejects(access(path.slice(0, -5) + ".md"), { code: "ENOENT" });
    assert.deepEqual(
      (await restarted.documents.list()).map(doc => doc.id),
      [sibling.id],
    );
    assert.equal((await restarted.jobs.get(document.id))?.summary.status, "completed");
    assert.equal(await readFile(exported, "utf8"), "User-edited export");
    const reopened = openFavorites();
    for (const collection of collections) {
      const page = await reopened.list(collection, { limit: 40 });
      assert.equal(page.items.length, 2);
      for (const item of page.items) {
        const snapshot = await reopened.get(collection, item.key);
        if (snapshot.snapshotVersion === 2)
          assert.equal(snapshot.document.markdown, notes.markdown);
        else assert.equal(snapshot.scene.title, document.sections[0].title);
      }
    }
    // Safe retries and restore use the same document identity without touching favorites.
    await createDocumentSync(storage).deleteLocal(document.id);
    await createDocumentSync(storage).restore(document.id, async () => document);
    assert.equal((await storage.documents.get(document.id))?.id, document.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletion waits for queued document work and rejects an unfinished source job", async () => {
  const root = await mkdtemp(join(tmpdir(), "cll-delete-queue-"));
  try {
    const { storage, document } = await completedLesson(root);
    const sync = createDocumentSync(storage);
    let release!: () => void;
    const work = serializeDocument(
      storage,
      document.id,
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        }),
    );
    await new Promise(resolve => setImmediate(resolve));
    const deletion = sync.deleteLocal(document.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(await storage.documents.get(document.id));
    release();
    await work;
    await deletion;
    assert.equal(await storage.documents.get(document.id), null);
    await sync.restore(document.id, async () => document);
    await storage.jobs.update(document.id, job => ({
      ...job,
      summary: { ...job.summary, status: "running" },
    }));
    await assert.rejects(sync.deleteLocal(document.id), /Only completed/);
    assert.ok(await storage.documents.get(document.id));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
