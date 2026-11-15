import assert from "node:assert/strict";
import test from "node:test";
import { authorizationCode } from "./oauth";

test("closing the owned OAuth tab aborts the callback wait and closes its listener", async () => {
  const controller = new AbortController();
  let opened!: (url: string) => void;
  const opening = new Promise<string>(resolve => {
    opened = resolve;
  });
  const pending = authorizationCode("synthetic.apps.googleusercontent.com", {
    signal: controller.signal,
    onAuthorization: opened,
  });
  const url = new URL(await opening);
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", url.searchParams.get("state")!);
  callback.searchParams.set("code", "unused-after-cancel");
  controller.abort();
  await assert.rejects(pending, /Google authorization was declined/);
  await assert.rejects(fetch(callback), /fetch failed/);
});

test("an already-cancelled login does not open a browser or listener", async () => {
  const controller = new AbortController();
  controller.abort();
  let opened = false;
  await assert.rejects(
    authorizationCode("synthetic", {
      signal: controller.signal,
      onAuthorization: () => {
        opened = true;
      },
    }),
    { name: "AbortError" },
  );
  assert.equal(opened, false);
});

test("a successful callback finishes normally and a late tab closure is harmless", async () => {
  const controller = new AbortController();
  let opened!: (url: string) => void;
  const opening = new Promise<string>(resolve => {
    opened = resolve;
  });
  const pending = authorizationCode("synthetic", {
    signal: controller.signal,
    onAuthorization: opened,
  });
  const url = new URL(await opening);
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", url.searchParams.get("state")!);
  callback.searchParams.set("code", "synthetic-code");
  const response = await fetch(callback);
  const session = await pending;
  assert.equal(session.code, "synthetic-code");
  session.finish("success");
  assert.equal(response.status, 200);
  assert.ok((await response.text()).length > 0);
  assert.doesNotThrow(() => controller.abort());
});
