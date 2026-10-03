import assert from "node:assert/strict";
import test from "node:test";
import { openNotificationDestination, NOTIFICATION_ROUTE_KEY } from "./notification-navigation";
const id = "lesson-complete:00000000-0000-4000-8000-000000000001";
test("notification opens Side Panel before awaiting routing storage, with a tab fallback on API rejection", async () => {
  const calls: string[] = [];
  let resolve!: () => void;
  const write = new Promise<void>(done => (resolve = done));
  const browser = {
    storage: {
      local: {
        remove: async () => {
          calls.push("remove-route");
        },
        set: (value: Record<string, unknown>) => {
          assert.ok(value[NOTIFICATION_ROUTE_KEY]);
          calls.push("store");
          return write;
        },
      },
    },
    sidePanel: {
      open: async () => {
        calls.push("panel");
      },
    },
    tabs: {
      create: async () => {
        calls.push("tab");
      },
    },
    runtime: { getURL: (url: string) => url },
    notifications: {
      clear: async () => {
        calls.push("clear");
      },
    },
  } as unknown as typeof chrome;
  const opened = openNotificationDestination(id, 7, browser);
  assert.deepEqual(calls, ["store", "panel"]);
  resolve();
  await opened;
  assert.deepEqual(calls, ["store", "panel", "clear"]);
  calls.length = 0;
  browser.sidePanel.open = async () => {
    calls.push("panel");
    throw new Error("User gesture rejected");
  };
  await openNotificationDestination(id, 7, browser);
  assert.deepEqual(calls, ["store", "panel", "remove-route", "tab", "clear"]);
});
