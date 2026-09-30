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
  }, null, () => null, "en"), /none match the selected learning language/);
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

test("a signed allowlisted caption URL reaches the worker boundary without a redundant page URL check", async () => {
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => [{ ...en, urls: [{ url }] }],
  };
  let received = "";
  const result = await readNetflixSubtitles(player, null, () => null, "en", {
    fetchDocument: async input => {
      received = String(input);
      return new Response(vtt, { status: 200 });
    },
  });
  assert.equal(received, url);
  assert.equal(parseSubtitles(result.text).length, 1);
});

test("Netflix accepts new learning language codes and checks available tracks", async () => {
  for (const language of ["es", "fr", "de", "it", "pt"]) {
    await assert.rejects(
      () => readNetflixSubtitles({}, null, () => null, language),
      /has not exposed subtitle tracks/,
      language + " passes the supported-language validation",
    );
  }
  await assert.rejects(() => readNetflixSubtitles({}, null, () => null, "xx"),
    /Unsupported learning language/);
});

test("rejects header-only captions at extraction stage instead of reporting success with zero cues", async () => {
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => [{ ...en, urls: [{ url }] }],
  };
  await assert.rejects(() => readNetflixSubtitles(player, null, () => null, "en", {
    fetchDocument: async () => new Response("WEBVTT\n\n", { status: 200 }),
  }), /contains no usable timed cues/);
});

test("briefly retries an empty track catalog after the video appears", async () => {
  let calls = 0;
  const player: NetflixCaptionPlayer = {
    getTimedTextTrackList: () => ++calls > 1 ? [{ ...en, urls: [{ url }] }] : [],
  };
  const video = { textTracks: [], duration: 200 } as unknown as HTMLVideoElement;
  const result = await readNetflixSubtitles(player, video, () => null, "en", {
    pause: async () => {}, fetchDocument: fakeFetch,
  });
  assert.equal(calls, 2);
  assert.equal(parseSubtitles(result.text).length, 1);
});

test("falls back to a complete already-exposed HTML text track when Netflix hides its internal player", async () => {
  const browserTrack = {
    language: "en-US", mode: "showing",
    cues: [
      { startTime: 2, endTime: 4, text: "Let's go." },
      { startTime: 60, endTime: 63, text: "Not yet." },
      { startTime: 88, endTime: 91, text: "All right." },
    ],
  };
  const video = { duration: 110, textTracks: [browserTrack] } as unknown as HTMLVideoElement;
  const result = await readNetflixSubtitles({}, video, () => null, "en", {
    pause: async () => {},
  });
  assert.equal(result.language, "en-US");
  assert.deepEqual(parseSubtitles(result.text).map(cue => [cue.startMs, cue.endMs]), [
    [2_000, 4_000], [60_000, 63_000], [88_000, 91_000],
  ]);
});

test("never mistakes only a currently displayed HTML cue for a full Netflix transcript", async () => {
  const video = { duration: 110, textTracks: [{
    language: "en-US", mode: "showing",
    cues: [{ startTime: 70, endTime: 73, text: "A single displayed cue." }],
  }] } as unknown as HTMLVideoElement;
  await assert.rejects(() => readNetflixSubtitles({}, video, () => null, "en", {
    pause: async () => {},
  }), /has not exposed subtitle tracks/);
});
