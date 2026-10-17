import assert from "node:assert/strict";
import test from "node:test";
import { SubtitleDraft, browserSubtitleAdapters } from "./subtitle-draft";
import { getVideoAdapter } from "../video";
import { VideoCommandError } from "../video/tab";
import { parseSubtitles } from "@contextual/core";
const url = "https://www.youtube.com/watch?v=abcdefghijk";
const other = "https://www.youtube.com/watch?v=lmnopqrstuv";
const caption = "1\n00:00:01,000 --> 00:00:02,000\nHello\n";
const video = (url: string) => ({ tabId: 1, windowId: 1, url, title: "Video" });
const earlyEndingCaptions =
  "1\n00:00:08.040 --> 00:00:11.440\nA sentence.\n\n2\n00:00:19.000 --> 00:00:21.000\n[Music]\n\n3\n00:00:31.800 --> 00:00:34.800\nNext sentence.";

test("draft uses shared effective YouTube times while retaining source precision and manual intent", () => {
  const draft = new SubtitleDraft("en", "zh-TW", adapters());
  draft.setSource(url);
  draft.importText(earlyEndingCaptions);
  assert.equal(draft.playbackCueMap().get("cue-1")!.endMs, 19000);
  assert.equal(draft.snapshot.cues[0].endMs, 11440);
  const cue = draft.snapshot.cues[0];
  draft.editCue(cue.id, { ...cue, originalText: "Edited text." }, undefined, "preserve");
  assert.equal(draft.snapshot.cues[0].endMs, 11440);
  assert.deepEqual(draft.snapshot.timingOverrides, {});
  assert.equal(draft.playbackCueMap().get(cue.id)!.endMs, 19000);
  // Intentionally choosing the original end is still a manual adjustment.
  draft.editCue(cue.id, { ...cue, originalText: "Edited text." });
  assert.equal(draft.playbackCueMap().get(cue.id)!.endMs, 11440);
  const restored = new SubtitleDraft("en", "zh-TW", adapters());
  restored.hydrateSaved(draft.exportSaved());
  assert.equal(restored.playbackCueMap().get(cue.id)!.endMs, 11440);
  assert.equal(restored.playbackCueMap(cue.id).get(cue.id)!.endMs, 19000);
  restored.editCue(cue.id, { ...cue, originalText: "Edited text." }, undefined, "reset");
  assert.equal(restored.playbackCueMap().get(cue.id)!.endMs, 19000);
  assert.equal(restored.snapshot.cues[0].endMs, 11440);
  assert.equal(restored.snapshot.cues[0].originalText, "Edited text.");
  assert.equal(restored.snapshot.originalRaw, earlyEndingCaptions);
});

test("legacy saved timing edits remain overrides and cannot shift a preceding automatic end", () => {
  const draft = new SubtitleDraft("en", "zh-TW", adapters());
  draft.setSource(url);
  draft.importText(earlyEndingCaptions);
  draft.editCue("cue-2", { originalText: "[Music]", startMs: 20500, endMs: 22500 });
  const saved = draft.exportSaved();
  for (const [, entry] of saved.entries) delete entry.timingOverrides;
  const restored = new SubtitleDraft("en", "zh-TW", adapters());
  restored.hydrateSaved(saved);
  assert.equal(restored.playbackCueMap().get("cue-1")!.endMs, 19000);
  assert.equal(restored.playbackCueMap().get("cue-2")!.startMs, 20500);
  assert.equal(restored.playbackCueMap().get("cue-2")!.endMs, 22500);
  restored.restoreOriginal();
  assert.deepEqual(restored.snapshot.timingOverrides, {});
  assert.equal(restored.playbackCueMap().get("cue-2")!.startMs, 19000);
});
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
test("timing edits retain source ruby; rewriting text clears only that cue's annotations", async () => {
  const raw =
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<ruby.under>面白<rt>おもしれ</rt></ruby>え～\n\n00:00:03.000 --> 00:00:04.000\n<ruby>赤福<rt>あかふく</rt></ruby>";
  const draft = new SubtitleDraft(
    "ja",
    "zh-TW",
    adapters({
      getAdapter: value => ({
        ...getVideoAdapter(value),
        availableSubtitleTracks: undefined,
        fetchSubtitles: async () => ({ text: raw, language: "ja" }),
      }),
    }),
  );
  draft.setSource(url);
  await draft.fetchSubtitles();
  const ruby = draft.snapshot.cues[0].ruby;
  draft.editCue("cue-1", { originalText: "面白え～", startMs: 1100, endMs: 2000 });
  assert.deepEqual(draft.snapshot.cues[0].ruby, ruby);
  assert.deepEqual(parseSubtitles(draft.snapshot.raw), draft.snapshot.cues);
  draft.editCue("cue-1", { originalText: "おもしれえ～", startMs: 1100, endMs: 2000 });
  assert.equal(draft.snapshot.cues[0].ruby, undefined);
  assert.ok(draft.snapshot.cues[1].ruby);
  assert.deepEqual(parseSubtitles(draft.snapshot.raw), draft.snapshot.cues);
  draft.restoreOriginal();
  assert.deepEqual(draft.snapshot.cues[0].ruby, ruby);
});
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

test("edits keep original source IDs, survive restoration, and reject invalid timing", async () => {
  const draft = new SubtitleDraft("en", "en", adapters());
  draft.setSource(url);
  await draft.fetchSubtitles();
  draft.editCue("cue-1", { originalText: "Edited line", startMs: 1100, endMs: 2100 }, 3000);
  assert.equal(draft.snapshot.originalRaw, caption);
  assert.equal(draft.snapshot.cues[0].id, "cue-1");
  assert.equal(draft.snapshot.edited, true);
  assert.throws(() =>
    draft.editCue("cue-1", { originalText: "Bad", startMs: 2000, endMs: 1000 }, 3000),
  );
  assert.equal(draft.snapshot.cues[0].originalText, "Edited line");
  const reopened = new SubtitleDraft("en", "en", adapters());
  reopened.setSource(url);
  reopened.hydrateSaved(structuredClone(draft.exportSaved()));
  assert.equal(reopened.snapshot.cues[0].originalText, "Edited line");
  assert.equal(reopened.snapshot.originalRaw, caption);
  reopened.restoreOriginal();
  assert.equal(reopened.snapshot.cues[0].originalText, "Hello");
  assert.equal(reopened.snapshot.edited, false);
});
test("refresh preserves edited subtitles until explicit acceptance of the fetched version", async () => {
  const draft = new SubtitleDraft("en", "en", adapters());
  draft.setSource(url);
  await draft.fetchSubtitles();
  draft.editCue("cue-1", { originalText: "Working copy", startMs: 1000, endMs: 2000 });
  await draft.fetchSubtitles();
  assert.equal(draft.snapshot.ready, true);
  assert.equal(draft.snapshot.cues[0].originalText, "Working copy");
  assert.equal(draft.snapshot.pendingCaption?.raw, caption);
  draft.resolveCaption(false);
  assert.equal(draft.snapshot.pendingCaption, null);
  assert.equal(draft.snapshot.cues[0].originalText, "Working copy");
  await draft.fetchSubtitles();
  draft.resolveCaption(true);
  assert.equal(draft.snapshot.cues[0].originalText, "Hello");
  assert.equal(draft.snapshot.edited, false);
});
test("edited source cache remains distinct across subtitle languages", async () => {
  const draft = new SubtitleDraft("en", "en", adapters());
  draft.setSource(url);
  await draft.fetchSubtitles();
  draft.editCue("cue-1", { originalText: "English edit", startMs: 1000, endMs: 2000 });
  draft.setLanguage("ja");
  draft.setLanguage("en");
  assert.equal(draft.snapshot.cues[0].originalText, "English edit");
  assert.equal(draft.snapshot.originalRaw, caption);
});

test("an unavailable video reader and page reload preserve existing subtitles without fetching again", async () => {
  for (const edited of [false, true]) {
    let readerReady = true;
    let fetches = 0;
    let reloads = 0;
    const ports = adapters({
      assertReady: async () => {
        if (!readerReady) throw new Error("outdated caption reader");
      },
      getAdapter: value => ({
        ...getVideoAdapter(value),
        availableSubtitleTracks: undefined,
        fetchSubtitles: async () => {
          fetches++;
          return { text: caption, language: "en" };
        },
      }),
      reloadTab: async (_adapter, sourceUrl) => {
        assert.equal(sourceUrl, url);
        reloads++;
        readerReady = true;
      },
    });
    const draft = new SubtitleDraft("en", "zh-TW", ports);
    draft.setSource(url);
    await draft.fetchSubtitles();
    if (edited)
      draft.editCue("cue-1", { originalText: "My edited subtitle", startMs: 1000, endMs: 2000 });
    const original = structuredClone(draft.snapshot);
    readerReady = false;
    await draft.fetchSubtitles();
    assert.equal(draft.snapshot.ready, true, "failed refresh must not invalidate usable subtitles");
    assert.equal(draft.snapshot.videoRecoveryUrl, url);
    assert.deepEqual(draft.snapshot.captionSource, original.captionSource);
    assert.deepEqual(draft.snapshot.cues, original.cues);
    await draft.reloadReader();
    assert.equal(reloads, 1);
    assert.equal(fetches, 1, "page reload must not retrieve subtitles again");
    assert.equal(draft.snapshot.videoRecoveryUrl, "");
    assert.equal(draft.snapshot.ready, true);
    assert.deepEqual(draft.snapshot.cues, original.cues);
    const reopened = new SubtitleDraft("en", "zh-TW", ports);
    reopened.hydrateSaved(structuredClone(draft.exportSaved()));
    assert.equal(reopened.snapshot.ready, true);
    assert.deepEqual(reopened.snapshot.cues, original.cues);
    assert.equal(fetches, 1, "restoring the cached transcript must not retrieve subtitles again");
  }
});
