import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { boundedDriveProperty, driveApiError, isPlaybackOnlyDriveRevision,
  MAX_DRIVE_PROPERTY_BYTES, validateDriveAppProperties } from "./api";
import { LearningDocumentSchema } from "@immersive/core";

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

test("Drive CJK and emoji titles fit appProperties UTF-8 limits without splitting code points", () => {
  const title = "畫完這個再去死 第12話【未來世界～今後也一直畫喜歡的東西吧】｜Muse木棉花 動畫 線上看 🎬".repeat(3);
  const shortened = boundedDriveProperty("immersiveTitle", title);
  assert.ok(title.startsWith(shortened));
  assert.ok(shortened.length < title.length);
  assert.ok(Buffer.byteLength("immersiveTitle", "utf8") +
    Buffer.byteLength(shortened, "utf8") <= MAX_DRIVE_PROPERTY_BYTES);
  assert.ok(Buffer.byteLength("immersiveTitle", "utf8") +
    Buffer.byteLength(shortened, "utf8") + Buffer.byteLength("日", "utf8") > MAX_DRIVE_PROPERTY_BYTES);

  const emoji = boundedDriveProperty("immersiveTitle", "🎬".repeat(40));
  assert.equal(emoji, "🎬".repeat(Math.floor(
    (MAX_DRIVE_PROPERTY_BYTES - Buffer.byteLength("immersiveTitle", "utf8")) / 4)));
  assert.doesNotMatch(emoji, /[\uD800-\uDBFF]$/);

  const properties = {
    immersiveSourceKey: "a".repeat(64), immersiveTranscriptKey: "b".repeat(64),
    immersiveSettingsKey: "c".repeat(64),
    immersiveDocumentId: "00000000-0000-4000-8000-000000000001",
    immersiveSchemaVersion: "3", immersiveTitle: shortened,
    immersiveCreatedAt: "2026-09-26T00:00:00.000Z",
    immersiveFormat: "json", immersiveDocumentKey: "d".repeat(64),
    immersiveContentHash: "e".repeat(64),
  };
  assert.doesNotThrow(() => validateDriveAppProperties(properties));
  assert.throws(() => validateDriveAppProperties({ ...properties, immersiveTitle: title }),
    /UTF-8 property size limit/);
  assert.throws(() => validateDriveAppProperties(Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => ["key" + index, "value"]))),
  /property count limit/);
});

test("Drive property length errors do not ask the user to reauthorize", () => {
  const error = driveApiError(403, { error: {
    errors: [{ reason: "propertyLengthLimitExceeded" }],
    message: "https://private.example?access_token=secret",
  } }, "備份教材");
  assert.match(error.message, /propertyLengthLimitExceeded/);
  assert.match(error.message, /UTF-8/);
  assert.match(error.message, /Native Host/);
  assert.doesNotMatch(error.message, /drive.file|請重新連結|private|secret/);
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

test("Drive accepts only a calibrated playback revision of an unchanged app lesson", () => {
  const before = LearningDocumentSchema.parse({
    id: "00000000-0000-4000-8000-000000000001", schemaVersion: 3,
    createdAt: "2026-09-26T00:00:00.000Z",
    source: { platform: "import", title: "Context" },
    profile: { targetLanguage: "en", instructionLanguage: "en", level: "B1",
      mode: "adaptive", maxNewVocabulary: 1, exerciseCount: 0, sceneCount: 1 },
    generation: { provider: "claude", modelId: "" },
    cues: [{ id: "a", startMs: 1000, endMs: 2000, originalText: "Hello" }],
    sections: [{
      id: "00000000-0000-4000-8000-000000000002", title: "Greeting", context: "Hello",
      learningGoal: "Greet", cueIds: ["a"], focusCueIds: ["a"], startMs: 1000, endMs: 2000,
      translations: [{ cueId: "a", text: "Hello" }], vocabulary: [], insights: [], exercises: [],
      focusItems: [{
        expression: "Hello", sourceCueIds: ["a"], meaning: "Hello",
        contextExplanation: "Hello", contextCueIds: ["a"], wordNotes: [],
        examples: [{ situation: "Meeting", dialogue: [
          { text: "Hello", translation: "Hello" }, { text: "Hello!", translation: "Hello!" },
        ] }],
      }],
    }],
  });
  if (before.schemaVersion !== 3) throw new Error("Unexpected schema");
  const after = LearningDocumentSchema.parse({
    ...before, playbackOverrides: { a: { startMs: 1100, endMs: 2200 } },
  });
  assert.equal(isPlaybackOnlyDriveRevision(before, after), true);
  assert.equal(isPlaybackOnlyDriveRevision(before, { ...after,
    cues: [{ ...after.cues[0], originalText: "Invented source" }] }), false);
  assert.equal(isPlaybackOnlyDriveRevision(after, after), false);
  assert.equal(isPlaybackOnlyDriveRevision(before, { ...before, playbackOverrides: {} }), true,
    "explicit reset metadata may replace legacy browser-only calibration");
});
