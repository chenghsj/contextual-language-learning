import assert from "node:assert/strict";
import test from "node:test";
import {
  createDriveKeychainStore,
  DRIVE_KEYCHAIN_SERVICE,
  LEGACY_DRIVE_KEYCHAIN_SERVICE,
} from "./keychain-credentials";

test("missing new Keychain item is copied from the old service and disconnect removes both", async () => {
  const items = new Map([[LEGACY_DRIVE_KEYCHAIN_SERVICE, "test-refresh-token"]]);
  const run = async (_command: string, args: string[]) => {
    const service = args[args.indexOf("-s") + 1];
    assert.equal(args[args.indexOf("-a") + 1], "account-id");
    if (args[0] === "find-generic-password") {
      if (!items.has(service)) throw Object.assign(new Error("missing"), { code: 44 });
      return { stdout: items.get(service)! + "\n" };
    }
    if (args[0] === "add-generic-password") items.set(service, args[args.indexOf("-w") + 1]);
    else if (args[0] === "delete-generic-password") items.delete(service);
    return { stdout: "" };
  };
  const store = createDriveKeychainStore(run, "darwin");
  assert.equal(await store.read("account-id"), "test-refresh-token");
  assert.equal(items.get(DRIVE_KEYCHAIN_SERVICE), "test-refresh-token");
  assert.equal(items.get(LEGACY_DRIVE_KEYCHAIN_SERVICE), "test-refresh-token");
  items.set(DRIVE_KEYCHAIN_SERVICE, "new-token");
  assert.equal(await store.read("account-id"), "new-token");
  await store.remove("account-id");
  assert.equal(items.size, 0);
});

test("denied Keychain access does not fall back to an older credential or expose command output", async () => {
  let calls = 0;
  const store = createDriveKeychainStore(async () => {
    calls++;
    throw Object.assign(new Error("private diagnostic"), { code: 128 });
  }, "darwin");
  await assert.rejects(store.read("account-id"), error => {
    assert.equal((error as Error).message.includes("private diagnostic"), false);
    return true;
  });
  assert.equal(calls, 1);
});
