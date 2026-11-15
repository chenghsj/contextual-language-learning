import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearGoogleSession, readGoogleSession, saveGoogleSession } from "./auth";
import { createBrowserDrive, DriveAccessError } from "./drive";

const account = { id: "test-account", email: "test@example.test" };
afterEach(() => {
  Reflect.deleteProperty(globalThis, "sessionStorage");
});
function storage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}
test("valid tab authorization survives restoration and logout clears it", () => {
  const values = storage();
  const authorization = { account, token: "synthetic-token", expiresAt: Date.now() + 3600_000 };
  saveGoogleSession("client", authorization);
  assert.deepEqual(readGoogleSession("client", account), authorization);
  clearGoogleSession();
  assert.equal(readGoogleSession("client", account), null);
  assert.equal(values.size, 0);
});
test("expired, near-expiry, malformed and other-account/client sessions cannot restore access", () => {
  const values = storage();
  const valid = { clientId: "client", account, token: "test", expiresAt: Date.now() + 3600_000 };
  for (const value of [
    { ...valid, expiresAt: Date.now() - 1 },
    { ...valid, expiresAt: Date.now() + 10_000 },
    { ...valid, account: { ...account, id: "other" } },
    { ...valid, clientId: "other" },
    { ...valid, token: null },
    { ...valid, expiresAt: "tomorrow" },
    null,
  ]) {
    values.set("cll-google-session", JSON.stringify(value));
    assert.equal(readGoogleSession("client", account), null);
    assert.equal(values.size, 0);
  }
  values.set("cll-google-session", "invalid json");
  assert.equal(readGoogleSession("client", account), null);
  assert.equal(values.size, 0);
});
test("unavailable session storage leaves in-memory usage possible", () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  saveGoogleSession("client", { account, token: "test", expiresAt: Date.now() + 3600_000 });
  assert.equal(readGoogleSession("client", account), null);
  assert.doesNotThrow(clearGoogleSession);
});
test("Drive 401 invalidates the reusable authorization without retrying it", async () => {
  const original = globalThis.fetch;
  let calls = 0,
    invalidated = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 401 });
  };
  try {
    const drive = createBrowserDrive("test", new AbortController().signal, () => invalidated++);
    await assert.rejects(
      drive.listLibrary(),
      error => error instanceof DriveAccessError && error.status === 401,
    );
    assert.equal(invalidated, 1);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
