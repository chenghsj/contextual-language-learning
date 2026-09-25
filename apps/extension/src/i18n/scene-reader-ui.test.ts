import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningDocument } from "@immersive/core";
import { SceneReader } from "../components/scene-reader";
import { getVideoAdapter } from "../video";
import { sceneReaderMessages } from "./scene-reader";
import { messages, type UiLocale } from "./messages";

const document: Extract<LearningDocument, { schemaVersion: 2 }> = {
  schemaVersion: 2,
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: { platform: "import", title: "A conversation" },
  profile: {
    targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
    mode: "adaptive", maxNewVocabulary: 2, exerciseCount: 1, sceneCount: 2,
  },
  generation: { provider: "claude", modelId: "" },
  cues: [
    { id: "line-1", startMs: 72000, endMs: 76000, originalText: "Can I ask a favor?" },
    { id: "line-2", startMs: 79000, endMs: 84000, originalText: "Of course." },
  ],
  sections: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      title: "Asking a favor", context: "A short request.",
      learningGoal: "Understand a polite request.",
      cueIds: ["line-1"], focusCueIds: ["line-1"],
      startMs: 72000, endMs: 76000,
      translations: [{ cueId: "line-1", text: "可以請你幫個忙嗎？" }],
      vocabulary: [], insights: [], exercises: [],
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      title: "Polite reply", context: "A friendly answer.",
      learningGoal: "Respond naturally.",
      cueIds: ["line-2"], focusCueIds: ["line-2"],
      startMs: 79000, endMs: 84000,
      translations: [{ cueId: "line-2", text: "當然。" }],
      vocabulary: [], insights: [], exercises: [],
    },
  ],
};

function renderReader(locale: UiLocale, withVideo = false): string {
  const playbackDocument: typeof document = withVideo ? {
    ...document,
    source: { platform: "netflix", title: document.source.title,
      url: "https://www.netflix.com/watch/82036383" },
  } : document;
  return renderToStaticMarkup(createElement(SceneReader, {
    document: playbackDocument,
    adapter: getVideoAdapter(playbackDocument.source.url),
    locale,
    repeat: "2", setRepeat: () => undefined,
    delay: 0, setDelay: () => undefined,
    playbackRate: 1, setPlaybackRate: () => undefined,
    onError: () => undefined, onDownload: () => undefined,
  }));
}

test("every locale has a direct scene picker, readable step names and independent scene navigation", async () => {
  const source = await readFile(new URL("../components/scene-reader.tsx", import.meta.url), "utf8");
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const copy = sceneReaderMessages[locale];
    const markup = renderReader(locale);
    assert.match(markup, /role="combobox"/);
    assert.match(markup, /id="study-scene-picker"/);
    assert.match(source, /value: String\(index\)/);
    assert.ok(markup.includes("Asking a favor"));
    assert.ok(markup.includes("Polite reply"));
    assert.match(markup, /aria-pressed="true"/);
    assert.match(markup, /class="sceneStepNumber"[^>]*>01/);
    assert.match(markup, /class="sceneStepNumber"[^>]*>02/);
    assert.match(markup, /class="sceneStepNumber"[^>]*>03/);
    assert.ok(markup.includes(copy.listen), locale + ": listen");
    assert.ok(markup.includes(copy.understand), locale + ": understand");
    assert.ok(markup.includes(copy.practice), locale + ": practice");
    assert.ok(markup.includes(copy.toUnderstand), locale + ": next learning step");
    assert.ok(markup.includes(copy.previousScene), locale + ": previous scene");
    assert.ok(markup.includes(copy.nextScene), locale + ": next scene");
    assert.ok(markup.includes(copy.listenHint), locale + ": current step explanation");
  }
});

test("scene switching, completion and step progression have separate handlers and readable sizing", async () => {
  const source = await readFile(new URL("../components/scene-reader.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /onValueChange=\{value => selectScene\(Number\(value\)\)\}/);
  assert.match(source, /onClick=\{\(\) => selectStep\(part\)\}/);
  assert.match(source, /const next = nextStudyStep\(step\)/);
  const finish = source.slice(source.indexOf("  function finishScene():"), source.indexOf("  function renderOriginal("));
  assert.doesNotMatch(finish, /selectScene\(|setMode\(/);
  assert.match(css, /\.sceneStepNumber \{[^}]*font-size: 16px/);
  assert.match(css, /\.sceneSteps button \{[^}]*min-height: 66px/);
  assert.match(css, /\.sceneNavigation \{[\s\S]*?grid-template-columns:/);
});

test("the mini player is collapsed by default and leaves one full-scene playback action in the scene header", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const copy = sceneReaderMessages[locale];
    const html = renderReader(locale, true);
    assert.match(html, /class="sceneQuickPlay"/);
    assert.match(html, /class="[^"]*scenePlayer[^"]*"/);
    assert.ok(html.includes("sceneMiniHeader"), locale + ": compact player title");
    assert.ok(html.includes("sceneMiniControls"), locale + ": compact controls");
    assert.ok(html.includes("sceneMiniLoop"), locale + ": focus loop toggle");
    assert.ok(html.includes(copy.repeatFocus), locale + ": focus loop label");
    assert.ok(html.includes(copy.playbackOptions), locale + ": settings label");
    assert.ok(html.includes(copy.openVideo), locale + ": open-video button accessible label");
    assert.ok(html.includes('aria-expanded="false"'), locale + ": settings closed initially");
    assert.doesNotMatch(html, /class="sceneMiniSettings"/, locale + ": expanded settings must be hidden");
    assert.equal(html.split(copy.playScene).length - 1, 1,
      locale + ": full-scene playback should appear only once");
    assert.ok(html.includes("sceneReadingSettings"), locale + ": study hints beside the steps");
    assert.ok(html.includes("settingInfo"), locale + ": playback subtitle notice is in info help");
    const readableMarkup = html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&");
    assert.ok(readableMarkup.includes(copy.originalSubtitleNotice),
      locale + ": existing subtitle notice remains available on demand");
  }
});

test("import-only lessons do not show a useless sticky player but keep study hint controls", () => {
  const html = renderReader("zh-TW");
  assert.doesNotMatch(html, /class="[^"]*scenePlayer[^"]*"/);
  assert.ok(html.includes("sceneReadingSettings"));
  assert.ok(html.includes(sceneReaderMessages["zh-TW"].noVideo));
});

test("compact playback keeps original loop settings and removes the old always-visible controls", async () => {
  const source = await readFile(new URL("../components/scene-reader.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /async function toggleFocusLoop\(\)/);
  assert.match(source, /if \(focusLoopActive\) await stopLoop\(\)/);
  assert.match(source, /else await playFocus\(selectedFocusCue\)/);
  assert.match(source, /setLoopingSceneId\(null\)/);
  assert.match(source, /aria-expanded=\{playbackSettingsOpen\}/);
  assert.match(source, /playbackSettingsOpen && <div className="sceneMiniSettings"/);
  assert.match(source, /<SelectField ariaLabel=\{c.repeat\} value=\{repeat\}/);
  assert.match(source, /<SelectField ariaLabel=\{c.delay\} value=\{delay\}/);
  assert.match(source, /<SelectField ariaLabel=\{c.speed\} value=\{playbackRate\}/);
  assert.doesNotMatch(source, /scenePlaybackSettings/);
  assert.match(css, /\.scenePlayer \{[^}]*padding: 9px 12px/);
  assert.match(css, /\.sceneMiniControls \{[^}]*grid-template-columns:/);
  assert.match(css, /\.sceneReadingSettings \{[^}]*margin:/);
});

test("reader opens in study with only Study and Review tabs; no watch-along polling", async () => {
  const source = await readFile(new URL("../components/scene-reader.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /type Mode = "learn" \| "review"/);
  assert.match(source, /useState<Mode>\("learn"\)/);
  assert.match(source, /\(\["learn", "review"\] as const\)/);
  assert.doesNotMatch(source, /watchScene|watchTime|watchAvailable|mode === "watch"|adapter\.status|setInterval\(poll/);
  assert.match(css, /\.sceneTabs \{[^}]*grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const copy = sceneReaderMessages[locale];
    const html = renderReader(locale, true);
    assert.equal((html.match(/role="tab"/g) ?? []).length, 2, locale + ": two tabs");
    assert.ok(html.includes(copy.learn), locale + ": study");
    assert.ok(html.includes(copy.review), locale + ": review");
    assert.ok(html.includes('class="scenePicker"'), locale + ": scene picker");
    assert.ok(html.includes('class="sceneMiniControls"'), locale + ": playback controls");
    for (const removed of ["watch", "watchHint", "watchNoScene", "watchUnavailable", "studyThis"]) {
      assert.equal(Object.hasOwn(copy, removed), false, locale + ": obsolete " + removed);
    }
  }
});
