import test from "node:test";
import assert from "node:assert/strict";
import { initialPiAuthState, piAuthReducer } from "./pi-auth-state";

test("login completion clears prompts, events and secrets in one transition", () => {
  let state = piAuthReducer(initialPiAuthState, {
    type: "start",
    kind: "login",
    id: "one",
    provider: "openai",
  });
  state = piAuthReducer(state, {
    type: "prompt",
    id: "one",
    prompt: { promptId: "secret", kind: "secret", message: "API key" },
  });
  state = piAuthReducer(state, { type: "value", id: "one", value: "synthetic-secret" });
  state = piAuthReducer(state, {
    type: "event",
    id: "one",
    event: { message: "Waiting", url: "https://example.test" },
  });
  state = piAuthReducer(state, { type: "finish", id: "one", status: "Cancelled" });
  assert.deepEqual(state, { kind: "idle", id: "one", provider: "openai", status: "Cancelled" });
  assert.doesNotMatch(JSON.stringify(state), /synthetic-secret|Waiting|example.test/);
});
test("only the current operation can finish, and terminal events cannot reopen a prompt", () => {
  let state = piAuthReducer(initialPiAuthState, {
    type: "start",
    kind: "login",
    id: "one",
    provider: "openai",
  });
  assert.equal(
    piAuthReducer(state, { type: "start", kind: "logout", id: "two", provider: "google" }),
    state,
  );
  state = piAuthReducer(state, { type: "finish", id: "one", status: "" });
  assert.equal(
    piAuthReducer(state, { type: "event", id: "one", event: { message: "Late event" } }),
    state,
  );
  state = piAuthReducer(state, { type: "start", kind: "login", id: "two", provider: "google" });
  assert.equal(piAuthReducer(state, { type: "finish", id: "one", status: "Late error" }), state);
});
test("a stale prompt-close does not erase the next prompt's input", () => {
  let state = piAuthReducer(initialPiAuthState, {
    type: "start",
    kind: "login",
    id: "one",
    provider: "openai",
  });
  state = piAuthReducer(state, {
    type: "prompt",
    id: "one",
    prompt: { promptId: "new", kind: "text", message: "Code" },
  });
  state = piAuthReducer(state, { type: "value", id: "one", value: "current-code" });
  assert.equal(piAuthReducer(state, { type: "promptClosed", id: "one", promptId: "old" }), state);
  assert.deepEqual(piAuthReducer(state, { type: "reset" }), initialPiAuthState);
});
