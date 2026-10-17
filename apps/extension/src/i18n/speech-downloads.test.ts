import test from "node:test";
import assert from "node:assert/strict";
import {
  speechDownloadCopy,
  speechDownloadError,
  speechVoiceLanguageName,
} from "./speech-downloads";

test("download failures show a localized actionable cause instead of a generic retry", () => {
  assert.equal(
    speechDownloadError(new Error("SIRI_RESOURCE_ALREADY_DOWNLOADED")),
    "alreadyDownloaded",
  );
  assert.equal(
    speechDownloadError(new Error("SIRI_DOWNLOAD_MISSING_CLIENT_IDENTITY")),
    "missingIdentity",
  );
  assert.equal(
    speechDownloadError(new Error("SIRI_DOWNLOAD_REJECTED (SiriTTSService.TTSError:1)")),
    "rejected",
  );
  assert.equal(
    speechDownloadError(new Error("SIRI_DOWNLOAD_REQUEST_TIMED_OUT")),
    "requestTimedOut",
  );
  assert.equal(speechDownloadError(new Error("Disconnected")), "failed");
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    assert.ok(speechDownloadCopy(locale).missingIdentity);
    assert.ok(speechDownloadCopy(locale).rejected);
    assert.ok(speechDownloadCopy(locale).requestTimedOut);
    assert.ok(speechDownloadCopy(locale).alreadyDownloaded);
  }
});

test("resource management copy is localized and language names distinguish regions", () => {
  const keys = Object.keys(speechDownloadCopy("en")).sort();
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    assert.deepEqual(Object.keys(speechDownloadCopy(locale)).sort(), keys);
    for (const key of [
      "title",
      "downloaded",
      "downloadable",
      "language",
      "allLanguages",
      "refresh",
      "noInstalledLanguage",
    ] as const)
      assert.ok(speechDownloadCopy(locale)[key]);
    const us = speechVoiceLanguageName("en-US", locale);
    const au = speechVoiceLanguageName("en-AU", locale);
    assert.notEqual(us, "en-US");
    assert.notEqual(us, au);
  }
  assert.equal(speechVoiceLanguageName("malformed_tag", "zh-TW"), "malformed_tag");
});
