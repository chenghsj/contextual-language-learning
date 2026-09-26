import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { driveApiError } from "./api";

test("Drive permission diagnostics show safe reason and relevant next action", () => {
  const error = driveApiError(403, {
    error: { status: "PERMISSION_DENIED", errors: [{ reason: "accessNotConfigured" }],
      message: "https://private.example?access_token=secret" },
  }, "列出雲端教材");
  assert.match(error.message, /HTTP 403，accessNotConfigured/);
  assert.match(error.message, /啟用 Drive API/);
  assert.doesNotMatch(error.message, /private\.example|access_token=secret/);
});

test("Drive errors distinguish rate limits, missing scopes and unexpected values", () => {
  assert.match(driveApiError(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } },
    "列出雲端教材").message, /稍後再試/);
  assert.match(driveApiError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } },
    "列出雲端教材").message, /drive.file/);
  const unknown = driveApiError(403, { error: { errors: [{ reason: "private://token" }] } },
    "https://private.example");
  assert.match(unknown.message, /unknown/);
  assert.doesNotMatch(unknown.message, /private|token/);
});

test("Drive validation calls the Drive API rather than only refreshing OAuth", async () => {
  const index = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("api.ts", import.meta.url), "utf8");
  assert.match(index, /case "driveValidate":\s*await validateDriveAccess\(request.accountId\)/);
  assert.match(api, /await listFiles\(accountId, "trashed = false", "id", 1, "驗證 Drive 權限"\)/);
});

test("new Google ErrorInfo details identify a disabled Drive API without exposing private text", () => {
  const error = driveApiError(403, {
    error: {
      status: "PERMISSION_DENIED",
      message: "https://private.example/file?access_token=secret",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED",
        metadata: { service: "drive.googleapis.com", consumer: "projects/123" } }],
    },
  }, "驗證 Drive 權限");
  assert.match(error.message, /HTTP 403，SERVICE_DISABLED/);
  assert.match(error.message, /啟用 Drive API/);
  assert.doesNotMatch(error.message, /private|secret|projects\/123/);
});

test("HTTP 403 permission denied alone does not incorrectly insist the user must reauthorize", () => {
  const error = driveApiError(403, { error: { status: "PERMISSION_DENIED" } }, "備份教材");
  assert.match(error.message, /HTTP 403，PERMISSION_DENIED/);
  assert.match(error.message, /Drive API/);
  assert.doesNotMatch(error.message, /重新連結/);
  assert.match(driveApiError(403, { error: { details: [
    { reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" },
  ] } }, "驗證 Drive 權限").message, /drive.file/);
});
