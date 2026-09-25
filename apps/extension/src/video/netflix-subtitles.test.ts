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
  assert.equal(subtitleUrlFromTrack({ ttDownloadables: {
    "webvtt-lssdh-ios8": { downloadUrls: { one: { url: "https://nflxvideo.net/track.vtt" } } },
  } }), "https://nflxvideo.net/track.vtt");
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
    documentElement: { localName: "tt", getAttribute: () => null },
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
  } as unknown as Document)), /unsupported subtitle XML/);
});

test("distinguishes Netflix XML without paragraphs from paragraphs without valid timing", () => {
  const root = { localName: "tt", getAttribute: () => null };
  const emptyXml = {
    documentElement: root,
    getElementsByTagName: () => [],
    getElementsByTagNameNS: () => [],
  } as unknown as Document;
  assert.throws(() => normalizeNetflixTimedText("<tt/>", () => emptyXml),
    /contains no timed-text paragraphs/);
  const invalidXml = {
    ...emptyXml,
    getElementsByTagNameNS: () => [{
      getAttribute: () => null, childNodes: [{ nodeType: 3, nodeValue: "Hello" }],
    }],
  } as unknown as Document;
  assert.throws(() => normalizeNetflixTimedText("<tt/>", () => invalidXml),
    /paragraphs but no usable timed cues/);
});

test("TTML clocks accept microsecond fractions and W3C tick/frame offsets", () => {
  assert.equal(subtitleClockMs("00:00:05.123456"), 5123);
  assert.equal(subtitleClockMs("00:00:01.123999"), 1124);
  assert.equal(subtitleClockMs("12500000t", 30, 1_000_000), 12_500);
  assert.equal(subtitleClockMs("45f", 30), 1500);
  assert.equal(subtitleClockMs("00:00:01:15.2", 30, 1, 10), 1507);
  assert.equal(subtitleClockMs("100t", 30, 0), null);
  assert.equal(subtitleClockMs("not-a-time"), null);
});

function fakeNetflixXml(
  rootLocalName: "tt" | "timedtext",
  rootAttributes: Record<string, string>,
  paragraphAttributes: Record<string, string>,
  content = "Hello Netflix",
  parent: Element | null = null,
): Document {
  const root = {
    localName: rootLocalName,
    getAttribute: (name: string) => rootAttributes[name] ?? null,
  };
  const paragraph = {
    getAttribute: (name: string) => paragraphAttributes[name] ?? null,
    parentElement: parent,
    nodeType: 1,
    localName: "p",
    childNodes: [{ nodeType: 3, nodeValue: content, childNodes: [] }],
  };
  return {
    documentElement: root,
    getElementsByTagName: () => [],
    getElementsByTagNameNS: () => [paragraph],
  } as unknown as Document;
}

test("Netflix TTML paragraphs use the declared tickRate instead of treating ticks as invalid", () => {
  const xml = fakeNetflixXml("tt",
    { "ttp:tickRate": "10000000" },
    { begin: "120000000t", end: "145000000t" });
  const vtt = normalizeNetflixTimedText("<tt/>", () => xml);
  assert.deepEqual(parseSubtitles(vtt).map(cue => ({
    start: cue.startMs, end: cue.endMs, text: cue.originalText,
  })), [{ start: 12_000, end: 14_500, text: "Hello Netflix" }]);
});

test("Netflix TTML supports fractional seconds, nested container offsets and dur", () => {
  const container = {
    localName: "div",
    getAttribute: (name: string) => name === "begin" ? "5s" : null,
    parentElement: null,
  } as unknown as Element;
  const xml = fakeNetflixXml("tt", {},
    { begin: "1.234567s", dur: "2.5s" }, "Full sentence", container);
  assert.deepEqual(parseSubtitles(normalizeNetflixTimedText("<tt/>", () => xml)).map(cue => ({
    start: cue.startMs, end: cue.endMs,
  })), [{ start: 6235, end: 8735 }]);
});

test("Netflix TTML frameRateMultiplier affects frame and default tick offsets", () => {
  const xml = fakeNetflixXml("tt",
    { "ttp:frameRate": "30", "ttp:frameRateMultiplier": "1000 1001" },
    { begin: "30t", end: "90t" });
  const [cue] = parseSubtitles(normalizeNetflixTimedText("<tt/>", () => xml));
  assert.equal(cue.startMs, 1001);
  assert.equal(cue.endMs, 3003);
});

test("Netflix timedtext p elements support numeric millisecond t/d attributes", () => {
  const xml = fakeNetflixXml("timedtext", {}, { t: "4500", d: "1250" }, "Timed text");
  const [cue] = parseSubtitles(normalizeNetflixTimedText("<timedtext/>", () => xml));
  assert.deepEqual({ start: cue.startMs, end: cue.endMs, text: cue.originalText },
    { start: 4500, end: 5750, text: "Timed text" });
});

test("unrecognized Netflix XML timings report only timing fields, never subtitle content", () => {
  const xml = fakeNetflixXml("tt", {}, { begin: "unknown_timing", end: "other_timing" }, "Secret subtitle content");
  assert.throws(() => normalizeNetflixTimedText("<tt/>", () => xml), error =>
    error instanceof Error && /paragraphs but no usable timed cues/.test(error.message) &&
    /begin=unknown?timing/.test(error.message) &&
    !error.message.includes("Secret subtitle content"));
});
