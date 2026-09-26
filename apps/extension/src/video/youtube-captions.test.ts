import assert from "node:assert/strict";
import test from "node:test";
import { parseSubtitles } from "@immersive/core";
import {
  allowedYouTubeCaptionUrl, chooseYouTubeCaptionTrack,
  observedYouTubeCaptionUrls, parsePlayerYouTubeCaptionResponse, readYouTubeCaptionTracks,
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

test("a captured player response succeeds even when the unsigned base URL is empty", () => {
  const signedUrl = "https://www.youtube.com/api/timedtext?v=" + videoId +
    "&lang=en&caps=asr&pot=session-private&fmt=json3";
  const body = JSON.stringify({ events: [
    { tStartMs: 4000, dDurationMs: 2500, segs: [{ utf8: "Hello world" }] },
  ] });
  const player = parsePlayerYouTubeCaptionResponse(signedUrl, body, videoId);
  assert.equal(parsePlayerYouTubeCaptionResponse(signedUrl, "", videoId), null);
  assert.deepEqual(player && {
    language: player.language, kind: player.kind,
    cues: parseSubtitles(player.text).length,
  }, { language: "en", kind: "asr", cues: 1 });
  assert.equal(parsePlayerYouTubeCaptionResponse(signedUrl, body, "AAAAAAAAAAA"), null);
  assert.equal(parsePlayerYouTubeCaptionResponse(signedUrl + "&tlang=ja", body, videoId), null);
  assert.equal(parsePlayerYouTubeCaptionResponse(signedUrl.replace("youtube.com", "youtube.com.evil.test"), body, videoId), null);
});


test("JSON3 uses actual segment offsets to split separate utterances rather than looping a long overlay", () => {
  const source = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 7200, segs: [
      { utf8: "うちは商業師ですから。", tOffsetMs: 0 },
      { utf8: "そうですよね。", tOffsetMs: 2500 },
      { utf8: "お疲れさまです。", tOffsetMs: 4900 },
    ] },
  ] });
  assert.deepEqual(parseSubtitles(youtubeJson3ToVtt(source)).map(cue =>
    ({ startMs: cue.startMs, endMs: cue.endMs, text: cue.originalText })), [
    { startMs: 1000, endMs: 3500, text: "うちは商業師ですから。" },
    { startMs: 3500, endMs: 5900, text: "そうですよね。" },
    { startMs: 5900, endMs: 8200, text: "お疲れさまです。" },
  ]);
});

test("JSON3 never fabricates sentence timing when offsets are missing or inconsistent", () => {
  for (const segs of [
    [{ utf8: "First sentence." }, { utf8: " Second sentence." }],
    [{ utf8: "First sentence.", tOffsetMs: 2000 }, { utf8: " Second sentence.", tOffsetMs: 1000 }],
    [{ utf8: "First sentence.", tOffsetMs: 0 }, { utf8: " Second sentence.", tOffsetMs: 200 }],
  ]) {
    const cues = parseSubtitles(youtubeJson3ToVtt(JSON.stringify({ events: [
      { tStartMs: 10_000, dDurationMs: 5000, segs },
    ] })));
    assert.equal(cues.length, 1);
    assert.equal(cues[0].originalText, "First sentence. Second sentence.");
    assert.equal(cues[0].endMs, 15_000);
  }
});

test("missing JSON3 duration uses the next source event time instead of a fixed two seconds", () => {
  const cues = parseSubtitles(youtubeJson3ToVtt(JSON.stringify({ events: [
    { tStartMs: 1000, segs: [{ utf8: "Long dialogue with no explicit duration." }] },
    { tStartMs: 7900, segs: [{ utf8: "Next line." }] },
  ] })));
  assert.deepEqual(cues.map(cue => [cue.startMs, cue.endMs]), [
    [1000, 7900], [7900, 9900],
  ]);
});


test("final JSON3 event with timed segments is not truncated to two seconds", () => {
  const cues = parseSubtitles(youtubeJson3ToVtt(JSON.stringify({ events: [
    { tStartMs: 1000, segs: [
      { utf8: "First sentence.", tOffsetMs: 0 },
      { utf8: " Second sentence.", tOffsetMs: 6200 },
    ] },
  ] })));
  // The source timestamps establish sentence starts. The unreported last
  // endpoint receives a conservative tail and remains manually adjustable.
  assert.deepEqual(cues.map(cue => [cue.startMs, cue.endMs]), [
    [1000, 7200], [7200, 9200],
  ]);
});

test("caption selection accepts additional language codes and regional tracks", () => {
  const tracks = [
    { languageCode: "es-ES", baseUrl: "https://www.youtube.com/api/timedtext?v=123" },
    { languageCode: "pt-BR", baseUrl: "https://www.youtube.com/api/timedtext?v=123" },
    { languageCode: "fr", kind: "asr" as const, baseUrl: "https://www.youtube.com/api/timedtext?v=123" },
  ];
  assert.equal(chooseYouTubeCaptionTrack(tracks, "es")?.languageCode, "es-ES");
  assert.equal(chooseYouTubeCaptionTrack(tracks, "pt")?.languageCode, "pt-BR");
  assert.equal(chooseYouTubeCaptionTrack(tracks, "fr")?.languageCode, "fr");
  assert.equal(chooseYouTubeCaptionTrack(tracks, "de"), null);
});
