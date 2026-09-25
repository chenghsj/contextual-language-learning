import assert from "node:assert/strict";
import test from "node:test";
import { parseSubtitles } from "@immersive/core";
import {
  allowedYouTubeCaptionUrl, chooseYouTubeCaptionTrack,
  observedYouTubeCaptionUrls, readYouTubeCaptionTracks,
  youtubeJson3ToVtt, youtubeTimedTextToVtt, youtubeXmlToVtt,
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

test("accept WEBVTT directly without requiring JSON3", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello\n";
  assert.equal(parseSubtitles(youtubeTimedTextToVtt(vtt)).length, 1);
  assert.throws(() => youtubeTimedTextToVtt(""), /readable subtitle document/);
});

test("convert legacy YouTube transcript XML with second-based timestamps", () => {
  const nodes = [
    { getAttribute: (key: string) => ({ start: "1.25", dur: "2.5" })[key as "start" | "dur"] ?? null,
      textContent: "Hello & welcome" },
    { getAttribute: (key: string) => ({ start: "4.0", dur: "1.0" })[key as "start" | "dur"] ?? null,
      textContent: "Next line" },
  ];
  const fakeXml = {
    documentElement: { localName: "transcript" },
    getElementsByTagName: (key: string) => key === "text" ? nodes : [],
    getElementsByTagNameNS: () => [],
  } as unknown as Document;
  const vtt = youtubeXmlToVtt("<transcript/>", () => fakeXml);
  assert.deepEqual(parseSubtitles(vtt).map(({ startMs, endMs, originalText }) =>
    ({ startMs, endMs, originalText })), [
    { startMs: 1250, endMs: 3750, originalText: "Hello & welcome" },
    { startMs: 4000, endMs: 5000, originalText: "Next line" },
  ]);
});

test("convert millisecond-based YouTube timedtext XML and reject unsupported XML", () => {
  const paragraph = { getAttribute: (key: string) =>
    ({ t: "2500", d: "1800" })[key as "t" | "d"] ?? null, textContent: "Timed text" };
  const fakeXml = {
    documentElement: { localName: "timedtext" },
    getElementsByTagName: () => [],
    getElementsByTagNameNS: () => [paragraph],
  } as unknown as Document;
  assert.equal(parseSubtitles(youtubeXmlToVtt("<timedtext/>", () => fakeXml))[0]?.endMs, 4300);
  assert.throws(() => youtubeXmlToVtt("<unrelated/>", () => ({
    ...fakeXml, documentElement: { localName: "unrelated" },
  } as Document)), /unsupported subtitle XML/);
});

test("only reuses player-observed caption requests for the current video and language", () => {
  const base = "https://www.youtube.com/api/timedtext?v=" + videoId + "&lang=en";
  const playerUrl = base + "&pot=session-token&fmt=json3";
  const unrelated = "https://example.com/api/timedtext?v=" + videoId + "&lang=en";
  const videoChanged = "https://www.youtube.com/api/timedtext?v=AAAAAAAAAAA&lang=en&pot=other";
  const wrongLanguage = base.replace("lang=en", "lang=ja") + "&pot=other";
  assert.deepEqual(observedYouTubeCaptionUrls([
    unrelated, videoChanged, wrongLanguage, base, playerUrl, playerUrl,
  ], videoId, "en"), [playerUrl, base]);
});

test("never accepts an observed caption URL without matching video identity", () => {
  assert.deepEqual(observedYouTubeCaptionUrls([
    "https://www.youtube.com/api/timedtext?lang=en&pot=token",
    "https://www.youtube.com/watch?v=" + videoId + "&lang=en",
  ], videoId, "en"), []);
});
