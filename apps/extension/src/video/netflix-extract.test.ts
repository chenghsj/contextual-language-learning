import assert from "node:assert/strict";
import test from "node:test";
import { parseSubtitles } from "@immersive/core";
import { readNetflixSubtitles, type NetflixCaptionPlayer, type NetflixCaptionTrack } from "./netflix-extract";

const url = "https://ipv4-c001.nflxvideo.net/track.vtt?token=signed";
const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello from Netflix.\n";
const en: NetflixCaptionTrack = { trackId: "english-1", bcp47: "en-US" };
const ja: NetflixCaptionTrack = { trackId: "japanese-1", bcp47: "ja-JP" };
const none: NetflixCaptionTrack = { trackId: "none", isNoneTrack: true };
const fakeFetch: typeof fetch = async () => new Response(vtt, { status: 200 });

test("fetches the requested caption document and preserves cue timestamps", async () => {
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => [ja, { ...en, ttDownloadables: {
      "webvtt-lssdh-ios8": { downloadUrls: { one: url } },
    } }],
  };
  const result = await readNetflixSubtitles(player, null, () => null, "en", { fetchDocument: fakeFetch });
  assert.equal(result.language, "en-US");
  assert.deepEqual(parseSubtitles(result.text)[0], {
    id: "cue-1", startMs: 1000, endMs: 3000, originalText: "Hello from Netflix.",
  });
});

test("resolves a signed URL from the current session's nested subtitle entries", async () => {
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => [en],
    getTimedTextTrack: () => en,
  };
  const session = { sessions: [{ fragments: [{ trackId: "english-1", urls: [{ url }] }] }] };
  const result = await readNetflixSubtitles(player, null, () => session, "en", { fetchDocument: fakeFetch });
  assert.equal(parseSubtitles(result.text).length, 1);
});

test("temporarily selects the requested track and restores the existing subtitle preference", async () => {
  let active = ja;
  let session: unknown = null;
  const changed: string[] = [];
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => [none, ja, en],
    getTimedTextTrack: () => active,
    setTimedTextTrack: track => {
      active = track;
      changed.push(track.trackId ?? "");
      if (track.trackId === en.trackId) session = {
        subtitles: [{ trackId: "english-1", urls: [{ url }] }],
      };
    },
  };
  const result = await readNetflixSubtitles(player, null, () => session, "en", {
    fetchDocument: fakeFetch, pause: async () => {},
  });
  assert.equal(parseSubtitles(result.text).length, 1);
  assert.deepEqual(changed, ["english-1", "japanese-1"]);
  assert.equal(active, ja);
});

test("does not return a different language or fabricate a missing Netflix caption track", async () => {
  await assert.rejects(() => readNetflixSubtitles({
    getTimedTextTrackList: () => [ja],
  }, null, () => null, "en"), /No subtitle track/);
});

test("rejects an inaccessible subtitle instead of claiming a complete transcript", async () => {
  let active = ja;
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => [none, en, ja],
    getTimedTextTrack: () => active,
    setTimedTextTrack: track => { active = track; },
  };
  await assert.rejects(() => readNetflixSubtitles(player, null, () => null, "en", {
    pause: async () => {},
  }), /did not expose/);
  assert.equal(active, ja);
});

test("rejects navigation to another Netflix title while subtitle fetch is running", async () => {
  let calls = 0;
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => [{ ...en, urls: [{ url }] }],
  };
  await assert.rejects(() => readNetflixSubtitles(player, null, () => null, "en", {
    fetchDocument: fakeFetch, sameVideo: () => ++calls === 1,
  }), /watch page changed/);
});

test("accepts getTextTrackList/getTextTrack/setTextTrack when timed-text APIs are absent", async () => {
  let active: NetflixCaptionTrack = ja;
  const changes: string[] = [];
  let session: unknown = null;
  const textEn: NetflixCaptionTrack = { id: "english-1", language: "en-US" };
  const player: NetflixCaptionPlayer = {
    getTextTrackList: () => [none, textEn, ja],
    getTextTrack: () => active,
    setTextTrack: track => {
      active = track;
      changes.push(track.trackId ?? track.id ?? "");
      if (track.id === textEn.id) session = {
        subtitles: [{ id: "english-1", downloadUrls: { primary: { url } } }],
      };
    },
  };
  const result = await readNetflixSubtitles(player, null, () => session, "en", {
    fetchDocument: fakeFetch, pause: async () => {},
  });
  assert.equal(parseSubtitles(result.text).length, 1);
  assert.deepEqual(changes, ["english-1", "japanese-1"]);
  assert.equal(active, ja);
});
