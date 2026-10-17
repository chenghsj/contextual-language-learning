import { pointsFixture } from "../../../../packages/core/test/learning-points-fixture";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  boundedDriveProperty,
  driveApiError,
  isPlaybackOnlyDriveRevision,
  isPlaybackOnlyMarkdownRevision,
  isLearningDriveFile,
  MAX_DRIVE_PROPERTY_BYTES,
  validateDriveAppProperties,
} from "./api";
import { LearningDocumentV7Schema, learningDocumentToMarkdown } from "@contextual/core";

test("Drive permission diagnostics show safe reason and relevant next action", () => {
  const error = driveApiError(
    403,
    {
      error: {
        status: "PERMISSION_DENIED",
        errors: [{ reason: "accessNotConfigured" }],
        message: "https://private.example?access_token=secret",
      },
    },
    "列出雲端教材",
  );
  assert.match(error.message, /HTTP 403，accessNotConfigured/);
  assert.match(error.message, /啟用 Drive API/);
  assert.doesNotMatch(error.message, /private\.example|access_token=secret/);
});

test("Drive errors distinguish rate limits, missing scopes and unexpected values", () => {
  assert.match(
    driveApiError(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "列出雲端教材")
      .message,
    /稍後再試/,
  );
  assert.match(
    driveApiError(
      403,
      { error: { errors: [{ reason: "insufficientPermissions" }] } },
      "列出雲端教材",
    ).message,
    /drive.file/,
  );
  const unknown = driveApiError(
    403,
    { error: { errors: [{ reason: "private://token" }] } },
    "https://private.example",
  );
  assert.match(unknown.message, /unknown/);
  assert.doesNotMatch(unknown.message, /private|token/);
});

test("Drive CJK and emoji titles fit appProperties UTF-8 limits without splitting code points", () => {
  const title =
    "畫完這個再去死 第12話【未來世界～今後也一直畫喜歡的東西吧】｜Muse木棉花 動畫 線上看 🎬".repeat(
      3,
    );
  const shortened = boundedDriveProperty("contextualTitle", title);
  assert.ok(title.startsWith(shortened));
  assert.ok(shortened.length < title.length);
  assert.ok(
    Buffer.byteLength("contextualTitle", "utf8") + Buffer.byteLength(shortened, "utf8") <=
      MAX_DRIVE_PROPERTY_BYTES,
  );
  assert.ok(
    Buffer.byteLength("contextualTitle", "utf8") +
      Buffer.byteLength(shortened, "utf8") +
      Buffer.byteLength("日", "utf8") >
      MAX_DRIVE_PROPERTY_BYTES,
  );

  const emoji = boundedDriveProperty("contextualTitle", "🎬".repeat(40));
  assert.equal(
    emoji,
    "🎬".repeat(
      Math.floor((MAX_DRIVE_PROPERTY_BYTES - Buffer.byteLength("contextualTitle", "utf8")) / 4),
    ),
  );
  assert.doesNotMatch(emoji, /[\uD800-\uDBFF]$/);

  const properties = {
    contextualSourceKey: "a".repeat(64),
    contextualTranscriptKey: "b".repeat(64),
    contextualSettingsKey: "c".repeat(64),
    contextualDocumentId: "00000000-0000-4000-8000-000000000001",
    contextualSchemaVersion: "3",
    contextualTitle: shortened,
    contextualCreatedAt: "2026-09-26T00:00:00.000Z",
    contextualFormat: "json",
    contextualDocumentKey: "d".repeat(64),
    contextualContentHash: "e".repeat(64),
  };
  assert.doesNotThrow(() => validateDriveAppProperties(properties));
  assert.throws(
    () => validateDriveAppProperties({ ...properties, contextualTitle: title }),
    /UTF-8 property size limit/,
  );
  assert.throws(
    () =>
      validateDriveAppProperties(
        Object.fromEntries(Array.from({ length: 31 }, (_, index) => ["key" + index, "value"])),
      ),
    /property count limit/,
  );
});

test("Drive property length errors do not ask the user to reauthorize", () => {
  const error = driveApiError(
    403,
    {
      error: {
        errors: [{ reason: "propertyLengthLimitExceeded" }],
        message: "https://private.example?access_token=secret",
      },
    },
    "備份教材",
  );
  assert.match(error.message, /propertyLengthLimitExceeded/);
  assert.match(error.message, /UTF-8/);
  assert.match(error.message, /Native Host/);
  assert.doesNotMatch(error.message, /drive.file|請重新連結|private|secret/);
});

test("Drive validation calls the Drive API rather than only refreshing OAuth", async () => {
  const index = await readFile(new URL("../host/drive.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("api.ts", import.meta.url), "utf8");
  assert.match(index, /case "driveValidate":\s*await validateDriveAccess\(request.accountId\)/);
  assert.match(api, /await listFiles\(accountId, "trashed = false", "id", 1, "驗證 Drive 權限"\)/);
});

test("new Google ErrorInfo details identify a disabled Drive API without exposing private text", () => {
  const error = driveApiError(
    403,
    {
      error: {
        status: "PERMISSION_DENIED",
        message: "https://private.example/file?access_token=secret",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "SERVICE_DISABLED",
            metadata: { service: "drive.googleapis.com", consumer: "projects/123" },
          },
        ],
      },
    },
    "驗證 Drive 權限",
  );
  assert.match(error.message, /HTTP 403，SERVICE_DISABLED/);
  assert.match(error.message, /啟用 Drive API/);
  assert.doesNotMatch(error.message, /private|secret|projects\/123/);
});

test("HTTP 403 permission denied alone does not incorrectly insist the user must reauthorize", () => {
  const error = driveApiError(403, { error: { status: "PERMISSION_DENIED" } }, "備份教材");
  assert.match(error.message, /HTTP 403，PERMISSION_DENIED/);
  assert.match(error.message, /Drive API/);
  assert.doesNotMatch(error.message, /重新連結/);
  assert.match(
    driveApiError(
      403,
      { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } },
      "驗證 Drive 權限",
    ).message,
    /drive.file/,
  );
});

test("Drive accepts only a calibrated playback revision of an unchanged app lesson", () => {
  const before = pointsFixture().document;
  const after = LearningDocumentV7Schema.parse({
    ...before,
    playbackOverrides: { "cue-1": { startMs: 1100, endMs: 2200 } },
  });
  assert.equal(isPlaybackOnlyDriveRevision(before, after), true);
  assert.equal(
    isPlaybackOnlyDriveRevision(before, {
      ...after,
      cues: [{ ...after.cues[0], originalText: "Invented source" }],
    }),
    false,
  );
  assert.equal(isPlaybackOnlyDriveRevision(after, after), false);
  const sceneId = before.sections[0].id;
  const sceneRevision = LearningDocumentV7Schema.parse({
    ...before,
    scenePlaybackOverrides: { [sceneId]: { startMs: 700, endMs: 2400 } },
  });
  assert.equal(isPlaybackOnlyDriveRevision(before, sceneRevision), true);
  assert.equal(isPlaybackOnlyDriveRevision(sceneRevision, sceneRevision), false);
  assert.equal(
    isPlaybackOnlyDriveRevision(before, {
      ...sceneRevision,
      sections: [{ ...before.sections[0], startMs: 700 }],
    }),
    false,
  );
  assert.equal(
    isPlaybackOnlyDriveRevision(before, { ...before, playbackOverrides: {} }),
    true,
    "explicit reset metadata may replace legacy browser-only calibration",
  );
  assert.equal(
    isPlaybackOnlyMarkdownRevision(
      learningDocumentToMarkdown(before),
      learningDocumentToMarkdown(after),
    ),
    true,
  );
  assert.equal(
    isPlaybackOnlyMarkdownRevision(
      learningDocumentToMarkdown(after),
      learningDocumentToMarkdown(sceneRevision),
    ),
    true,
  );
  assert.equal(
    isPlaybackOnlyMarkdownRevision(
      learningDocumentToMarkdown(before),
      learningDocumentToMarkdown({
        ...after,
        source: { ...after.source, title: "Changed lesson" },
      }),
    ),
    false,
  );
});

test("retired Drive lessons are excluded", () => {
  for (const contextualSchemaVersion of ["1", "2", "3", "4", "5", "6"])
    assert.equal(isLearningDriveFile({ appProperties: { contextualSchemaVersion } }), false);
});
