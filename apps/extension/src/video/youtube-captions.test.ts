import assert from "node:assert/strict";
import test from "node:test";
import { parseSubtitles } from "@immersive/core";
import {
  allowedYouTubeCaptionUrl, chooseYouTubeCaptionTrack,
  readYouTubeCaptionTracks, youtubeJson3ToVtt,
} from "./youtube-captions";

const videoId = "dQw4w9WgXcQ";

test("only accept tracks belonging to the current YouTube watch video", () => {
  const response = {
    videoDetails: { videoId },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: [
      { languageCode: "en", kind: "asr", baseUrl: "https://www.youtube.com/api/timedtext?v=" + videoId },
      { languageCode: "en-GB", baseUrl: "https://www.youtube.com/api/timedtext?v=" + videoId },
      { languageCode: "ja", baseUrl: "https://www.youtube.com/api/timedtext?v=" + videoId },
    ] } },
  };
  assert.equal(readYouTubeCaptionTracks(response, "AAAAAAAAAAA").length, 0);
  const tracks = readYouTubeCaptionTracks(response, videoId);
  assert.equal(tracks.length, 3);
  assert.equal(chooseYouTubeCaptionTrack(tracks, "en")?.languageCode, "en");
  assert.equal(chooseYouTubeCaptionTrack(tracks, "ko"), null);
});

test("prefer manual YouTube captions over ASR within the same locale", () => {
  const url = "https://www.youtube.com/api/timedtext?v=" + videoId;
  assert.equal(chooseYouTubeCaptionTrack([
    { languageCode: "en", kind: "asr", baseUrl: url },
    { languageCode: "en", baseUrl: url },
  ], "en")?.kind, undefined);
});

test("reject unexpected or cross-video caption requests", () => {
  const base = "https://www.youtube.com/api/timedtext?v=" + videoId;
  assert.equal(allowedYouTubeCaptionUrl(base, videoId).hostname, "www.youtube.com");
  for (const value of [
    "http://www.youtube.com/api/timedtext?v=" + videoId,
    "https://www.youtube.com.evil.example/api/timedtext?v=" + videoId,
    "https://www.youtube.com/api/timedtext?v=AAAAAAAAAAA",
    "https://www.youtube.com/watch?v=" + videoId,
  ]) {
    assert.throws(() => allowedYouTubeCaptionUrl(value, videoId), /unexpected subtitle address/);
  }
});

test("convert YouTube JSON3 into timestamped WEBVTT without losing cue text", () => {
  const payload = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 1350, segs: [{ utf8: "Hello" }, { utf8: " world" }] },
    { tStartMs: 2400, dDurationMs: 800, segs: [{ utf8: "\n" }] },
    { tStartMs: 3000, segs: [{ utf8: "Second line" }] },
  ] });
  const cues = parseSubtitles(youtubeJson3ToVtt(payload));
  assert.deepEqual(cues.map(cue => ({
    startMs: cue.startMs, endMs: cue.endMs, originalText: cue.originalText,
  })), [
    { startMs: 1000, endMs: 2350, originalText: "Hello world" },
    { startMs: 3000, endMs: 5000, originalText: "Second line" },
  ]);
});

test("reject unusable or oversized YouTube transcript rather than inventing captions", () => {
  assert.throws(() => youtubeJson3ToVtt("{}"), /readable subtitle document/);
  assert.throws(() => youtubeJson3ToVtt(JSON.stringify({ events: [
    { tStartMs: 0, segs: [{ utf8: " ".repeat(10) }] },
  ] })), /readable subtitle cues/);
  assert.throws(() => youtubeJson3ToVtt(JSON.stringify({ events: [
    { tStartMs: 0, segs: [{ utf8: "a".repeat(1501) }] },
  ] })), /size limit/);
});
