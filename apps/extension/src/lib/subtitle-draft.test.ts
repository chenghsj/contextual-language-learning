import assert from "node:assert/strict";
import test from "node:test";
import { SubtitleDraft, browserSubtitleAdapters } from "./subtitle-draft";
import { getVideoAdapter } from "../video";
import { VideoCommandError } from "../video/tab";
const url = "https://www.youtube.com/watch?v=abcdefghijk";
const other = "https://www.youtube.com/watch?v=lmnopqrstuv";
const caption = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";
const video = (url: string) => ({ tabId: 1, windowId: 1, url, title: "Video" });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function adapters(overrides: Partial<typeof browserSubtitleAdapters> = {}) {
  return {
    ...browserSubtitleAdapters,
    getAdapter: (value?: string) => ({
      ...getVideoAdapter(value),
      availableSubtitleTracks: undefined,
      fetchSubtitles: async () => ({ text: caption, language: "en" }),
    }),
    selectedTab: async () => ({ id: 1, windowId: 1, url }) as chrome.tabs.Tab,
    findTab: async (_adapter: unknown, value?: string) =>
      ({ id: 1, windowId: 1, url: value ?? url }) as chrome.tabs.Tab,
    assertReady: async () => {},
    titleForTab: async () => "Video",
    ...overrides,
  };
}
test("returning to cached video subtitles recovers after a missing language without another request", async () => {
  const requested: string[] = [];
  const draft = new SubtitleDraft(
    "en",
    "zh-TW",
    adapters({
      getAdapter: value => ({
        ...getVideoAdapter(value),
        availableSubtitleTracks: undefined,
        fetchSubtitles: async (_url, language) => {
          requested.push(language);
          if (requested.length > 1)
            throw new VideoCommandError("Missing track", "TRACK_UNAVAILABLE");
          return { text: caption, language: "en" };
        },
      }),
    }),
  );
  draft.setSource(url);
  await draft.fetchSubtitles();
  draft.setLanguage("ja");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(draft.snapshot.ready, false);
  assert.equal(draft.snapshot.subtitleTone, "missing");
  assert.equal(draft.snapshot.raw, caption);
  draft.setLanguage("en");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(draft.snapshot.ready, true);
  assert.equal(draft.snapshot.subtitleTone, "success");
  assert.equal(draft.snapshot.subtitleBusy, false);
  assert.deepEqual(requested, ["en", "ja"]);
});

test("late results from a missing language cannot invalidate restored cached subtitles", async () => {
  for (const failure of [false, true]) {
    const pending = deferred<{ text: string; language: string }>();
    const draft = new SubtitleDraft(
      "en",
      "en",
      adapters({
        getAdapter: value => ({
          ...getVideoAdapter(value),
          availableSubtitleTracks: undefined,
          fetchSubtitles: async (_url, language) =>
            language === "ja" ? pending.promise : { text: caption, language: "en" },
        }),
      }),
    );
    draft.setSource(url);
    await draft.fetchSubtitles();
    draft.setLanguage("ja");
    await new Promise(resolve => setImmediate(resolve));
    draft.setLanguage("en");
    assert.equal(draft.snapshot.ready, true);
    if (failure) pending.reject(new VideoCommandError("Missing track", "TRACK_UNAVAILABLE"));
    else pending.resolve({ text: caption.replace("Hello", "Japanese"), language: "ja" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(draft.snapshot.ready, true);
    assert.equal(draft.snapshot.raw, caption);
    assert.equal(draft.snapshot.captionSource?.language, "en");
    assert.equal(draft.snapshot.subtitleTone, "success");
  }
});
test("manual subtitles stay bound to their source and language; the original language cache restores readiness", async () => {
  const draft = new SubtitleDraft("en", "en", adapters());
  draft.setSource(url);
  draft.importText("Manual text");
  assert.equal(draft.snapshot.ready, true);
  await draft.selectVideo(video(other));
  assert.equal(draft.snapshot.sourceUrl, url);
  assert.equal(draft.snapshot.raw, "Manual text");
  draft.setLanguage("ja");
  assert.equal(draft.snapshot.ready, false);
  assert.equal(draft.snapshot.raw, "Manual text");
  draft.setLanguage("en");
  assert.equal(draft.snapshot.ready, true);
});
test("stale caption success and failure cannot replace a newer manual import", async () => {
  for (const failure of [false, true]) {
    const pending = deferred<{ text: string; language: string }>();
    const draft = new SubtitleDraft(
      "en",
      "en",
      adapters({
        getAdapter: value => ({ ...getVideoAdapter(value), fetchSubtitles: () => pending.promise }),
      }),
    );
    draft.setSource(url);
    const fetch = draft.fetchSubtitles();
    await new Promise(resolve => setImmediate(resolve));
    draft.importText("New manual draft");
    if (failure) pending.reject(new Error("stale failure"));
    else pending.resolve({ text: caption, language: "en" });
    await fetch;
    assert.equal(draft.snapshot.raw, "New manual draft");
    assert.equal(draft.snapshot.ready, true);
    assert.equal(draft.snapshot.subtitleTone, "neutral");
    assert.equal(draft.snapshot.error, "");
  }
});
test("late file failure and metadata response are discarded; oversized files are rejected before reading", async () => {
  const file = deferred<string>(),
    metadata = deferred<Awaited<ReturnType<typeof browserSubtitleAdapters.detectMetadata>>>();
  const draft = new SubtitleDraft("en", "en", adapters({ detectMetadata: () => metadata.promise }));
  const first = draft.importFile({ size: 10, name: "old.txt", text: () => file.promise });
  draft.importText("Newest");
  file.reject(new Error("old file failed"));
  await first;
  assert.equal(draft.snapshot.raw, "Newest");
  assert.equal(draft.snapshot.error, "");
  const detection = draft.fetchMetadata();
  draft.setTitle("Manual title");
  metadata.resolve({
    tabId: 1,
    url: other,
    title: "Late title",
    platform: "youtube",
    videoId: "lmnopqrstuv",
  });
  await detection;
  assert.equal(draft.snapshot.title, "Manual title");
  assert.equal(draft.snapshot.sourceUrl, "");
  await draft.importFile({
    size: 2000001,
    name: "too-large.txt",
    text: async () => assert.fail("must not read"),
  });
  assert.equal(draft.snapshot.raw, "Newest");
  assert.ok(draft.snapshot.error);
});
