import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecureCredentialStore } from "./credentials";

const key = (value: string) => ({ type: "api_key" as const, key: value });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "cll-credential-batch-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("concurrent read/list calls share one lookup, return independent values and discard the snapshot", () =>
  fixture(async root => {
    let reads = 0;
    let data = JSON.stringify({ openai: key("first") });
    const store = createSecureCredentialStore(root, {
      legacyPaths: [],
      vault: {
        read: async () => {
          reads++;
          return data;
        },
        write: async value => {
          data = value;
        },
      },
    });
    const [first, second, list] = await Promise.all([
      store.read("openai"),
      store.read("openai"),
      store.list(),
    ]);
    assert.equal(reads, 1);
    assert.deepEqual(list, [{ providerId: "openai", type: "api_key" }]);
    assert.notEqual(first, second);
    if (first?.type === "api_key") first.key = "mutated-by-caller";
    assert.deepEqual(second, key("first"));
    data = JSON.stringify({ openai: key("external-change") });
    assert.deepEqual(await store.read("openai"), key("external-change"));
    assert.equal(reads, 2, "a later request must read system storage again");
  }));
test("reads after another store's queued mutation observe the change instead of joining an older snapshot", () =>
  fixture(async root => {
    let data = JSON.stringify({ openai: key("first") });
    const entered = deferred(),
      release = deferred();
    let block = true;
    const options = {
      legacyPaths: [],
      vault: {
        read: async () => {
          const snapshot = data;
          if (block) {
            block = false;
            entered.resolve();
            await release.promise;
          }
          return snapshot;
        },
        write: async (value: string) => {
          data = value;
        },
      },
    };
    const store = createSecureCredentialStore(root, options);
    const writer = createSecureCredentialStore(root, options);
    const before = store.read("openai");
    await entered.promise;
    const mutation = writer.modify("openai", async () => key("updated"));
    const after = store.read("openai");
    release.resolve();
    assert.deepEqual(await before, key("first"));
    await mutation;
    assert.deepEqual(await after, key("updated"));
    const removing = writer.delete("openai");
    const afterDelete = store.read("openai");
    await removing;
    assert.equal(await afterDelete, undefined);
  }));
test("cancelling one reader leaves the shared lookup available to other callers", () =>
  fixture(async root => {
    const entered = deferred(),
      release = deferred();
    let reads = 0;
    const store = createSecureCredentialStore(root, {
      legacyPaths: [],
      vault: {
        read: async () => {
          reads++;
          entered.resolve();
          await release.promise;
          return JSON.stringify({ openai: key("shared") });
        },
        write: async () => {
          assert.fail("read-only batch cannot write credentials");
        },
      },
    });
    const controller = new AbortController();
    const cancelled = store.read("openai", { signal: controller.signal });
    const other = store.read("openai");
    await entered.promise;
    controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    release.resolve();
    assert.deepEqual(await other, key("shared"));
    assert.equal(reads, 1);
    assert.deepEqual(await store.read("openai"), key("shared"));
    assert.equal(reads, 2);
  }));
test("a failed shared read is evicted so the next request can recover", () =>
  fixture(async root => {
    let reads = 0;
    const store = createSecureCredentialStore(root, {
      legacyPaths: [],
      vault: {
        read: async () => {
          if (++reads === 1) throw new Error("fixture vault locked");
          return "{}";
        },
        write: async () => {
          assert.fail("read-only batch cannot write credentials");
        },
      },
    });
    const results = await Promise.allSettled([store.read("openai"), store.list()]);
    assert.deepEqual(
      results.map(result => result.status),
      ["rejected", "rejected"],
    );
    assert.equal(reads, 1);
    assert.deepEqual(await store.list(), []);
    assert.equal(reads, 2);
  }));
