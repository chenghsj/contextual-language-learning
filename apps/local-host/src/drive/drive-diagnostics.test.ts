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
