import assert from "node:assert/strict";
import test from "node:test";
import { parseSubtitles } from "@immersive/core";
import {
  allowedNetflixSubtitleUrl, formatVttClock, normalizeNetflixTimedText,
  normalizedVttCues, subtitleClockMs, subtitleUrlFromTrack,
} from "./netflix-subtitles";

test("only existing HTTPS Netflix caption endpoints are used", () => {
  assert.equal(allowedNetflixSubtitleUrl("https://a.nflxvideo.net/timedtext.vtt?token=abc"), true);
  assert.equal(allowedNetflixSubtitleUrl("https://nflximg.net/subtitle.xml"), true);
  assert.equal(allowedNetflixSubtitleUrl("https://nflxvideo.net.evil.test/subtitle.xml"), false);
  assert.equal(allowedNetflixSubtitleUrl("http://a.nflxvideo.net/track.vtt"), false);
  assert.equal(allowedNetflixSubtitleUrl("https://user:pass@a.nflxvideo.net/sub.xml"), false);
  assert.equal(allowedNetflixSubtitleUrl("file:///private/track.vtt"), false);
});

test("Netflix metadata resolves signed text-track URLs, never arbitrary content", () => {
  assert.equal(subtitleUrlFromTrack({ ttDownloadables: {
    "webvtt-lssdh-ios8": { downloadUrls: {
      one: "https://ipv4-c001.nflxvideo.net/text?v=1&token=abc",
    } },
  } }), "https://ipv4-c001.nflxvideo.net/text?v=1&token=abc");
  assert.equal(subtitleUrlFromTrack({ urls: [{ url: "https://evil.test/track.xml" }] }), null);
  assert.equal(subtitleUrlFromTrack({ urls: [{ url: "https://nflxvideo.net/track.xml" }] }),
    "https://nflxvideo.net/track.xml");
});

test("TTML clock, frames and offsets convert to milliseconds", () => {
  assert.equal(subtitleClockMs("00:01:02.123"), 62_123);
  assert.equal(subtitleClockMs("00:01:02:15", 30), 62_500);
  assert.equal(subtitleClockMs("1.5s"), 1500);
  assert.equal(subtitleClockMs("900ms"), 900);
  assert.equal(subtitleClockMs("invalid"), null);
  assert.equal(formatVttClock(3_602_005), "01:00:02.005");
});

test("browser XML cue nodes normalize to VTT and existing lesson cues", () => {
  const paragraph = {
    getAttribute: (name: string) => ({ begin: "00:00:10.000", end: "00:00:12.500" })[name as "begin" | "end"] ?? null,
    nodeType: 1, localName: "p", childNodes: [{ nodeType: 3, nodeValue: "Hello & welcome!", childNodes: [] }],
  };
  const xml = {
    getElementsByTagName: () => [],
    getElementsByTagNameNS: () => [paragraph],
    documentElement: { getAttribute: () => null },
  } as unknown as Document;
  const vtt = normalizeNetflixTimedText("<tt/>", () => xml);
  assert.deepEqual(parseSubtitles(vtt), [{
    id: "cue-1", startMs: 10_000, endMs: 12_500, originalText: "Hello & welcome!",
  }]);
});

test("reject empty and oversized captions instead of claiming success", () => {
  assert.throws(() => normalizedVttCues([]), /No usable/);
  assert.throws(() => normalizedVttCues([{
    startMs: 0, endMs: 1000, text: "x".repeat(220_001),
  }]), /too long/);
  assert.throws(() => normalizeNetflixTimedText("<unsupported/>", () => ({
    getElementsByTagName: () => [],
    getElementsByTagNameNS: () => [],
    documentElement: { getAttribute: () => null },
  } as unknown as Document)), /No usable/);
});
