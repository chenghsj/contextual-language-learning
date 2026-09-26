import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { googleTokenError } from "./drive/oauth";

test("Google OAuth token errors show a safe code and missing Desktop secret guidance", () => {
  const error = googleTokenError(400, {
    error: "invalid_request",
    error_description: "client_secret is missing. This body contains private-refresh-token",
    access_token: "private-access-token",
  });
  assert.match(error.message, /HTTP 400.*invalid_request/);
  assert.match(error.message, /GOOGLE_OAUTH_CLIENT_SECRET/);
  assert.doesNotMatch(error.message, /private-refresh-token|private-access-token/);
});

test("OAuth diagnostics identify an expired authorization code without leaking raw responses", () => {
  const error = googleTokenError(400, {
    error: "invalid_grant",
    error_description: "expired code private-authorization-code",
  });
  assert.match(error.message, /invalid_grant/);
  assert.match(error.message, /重新連結/);
  assert.doesNotMatch(error.message, /private-authorization-code/);
});

test("unexpected OAuth errors do not echo arbitrary codes or descriptions", () => {
  const error = googleTokenError(400, {
    error: "secret-secret-too-long!",
    error_description: "value=PRIVATE_CREDENTIAL",
  });
  assert.match(error.message, /unknown/);
  assert.doesNotMatch(error.message, /PRIVATE_CREDENTIAL|secret-secret-too-long/);
});

test("optional Desktop client secret is available at build time for code and refresh exchanges", async () => {
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  const oauth = await readFile(new URL("drive/oauth.ts", import.meta.url), "utf8");
  assert.match(build, /__GOOGLE_OAUTH_CLIENT_SECRET__: JSON.stringify\(clientSecret\)/);
  assert.equal(oauth.match(/form.set\("client_secret", config.clientSecret\)/g)?.length, 2);
  assert.doesNotMatch(build, /console\.log\(clientSecret\)/);
});
