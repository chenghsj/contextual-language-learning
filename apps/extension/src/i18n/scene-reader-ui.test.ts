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

function renderReader(locale: UiLocale): string {
  return renderToStaticMarkup(createElement(SceneReader, {
    document,
    adapter: getVideoAdapter(undefined),
    locale,
    repeat: "2", setRepeat: () => undefined,
    delay: 0, setDelay: () => undefined,
    playbackRate: 1, setPlaybackRate: () => undefined,
    onError: () => undefined, onDownload: () => undefined,
  }));
}

test("every locale has a direct scene picker, readable step names and independent scene navigation", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const copy = sceneReaderMessages[locale];
    const markup = renderReader(locale);
    assert.match(markup, /<select[^>]+id="study-scene-picker"/);
    assert.match(markup, /<option[^>]+value="0"/);
    assert.match(markup, /<option[^>]+value="1"/);
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
  assert.match(source, /onChange=\{event => selectScene\(Number\(event\.target\.value\)\)\}/);
  assert.match(source, /onClick=\{\(\) => selectStep\(part\)\}/);
  assert.match(source, /const next = nextStudyStep\(step\)/);
  const finish = source.slice(source.indexOf("  function finishScene():"), source.indexOf("  function renderOriginal("));
  assert.doesNotMatch(finish, /selectScene\(|setMode\(/);
  assert.match(css, /\.sceneStepNumber \{[^}]*font-size: 16px/);
  assert.match(css, /\.sceneSteps button \{[^}]*min-height: 66px/);
  assert.match(css, /\.sceneNavigation \{[\s\S]*?grid-template-columns:/);
});

test("collapsed mini player exposes compact playback and an accessible settings toggle in every locale", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const copy = sceneReaderMessages[locale];
    const markup = renderReader(locale);
    assert.match(markup, /class="[^"]*scenePlayer[^"]*"/);
    assert.match(markup, /class="miniPlayerActions"/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /aria-controls="mini-player-settings"/);
    assert.ok(markup.includes(copy.playScene), locale + ": play scene");
    assert.ok(markup.includes(copy.repeatFocus), locale + ": loop focus line");
    assert.ok(markup.includes(copy.showPlayerSettings), locale + ": open settings");
    assert.doesNotMatch(markup, /class="miniPlayerSettings"/);
    assert.doesNotMatch(markup, /id="mini-player-settings"/);
  }
});

test("expanded mini-player contains repeat count, loop delay and supported playback speed", async () => {
  const source = await readFile(new URL("../components/scene-reader.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(source, /\{playerExpanded && <div className="miniPlayerSettings" id="mini-player-settings">/);
  assert.match(source, /className="miniPlayerSettingsGrid"/);
  assert.match(source, /\{c\.repeat\}/);
  assert.match(source, /\{c\.delay\}/);
  assert.match(source, /\{adapter\.setPlaybackRate && <label>\{c\.speed\}/);
  assert.match(source, /onChange=\{event => setRepeat\(event\.target\.value as Repeat\)\}/);
  assert.match(source, /onChange=\{event => setDelay\(Number\(event\.target\.value\)\)\}/);
  assert.match(source, /onChange=\{event => void changeRate\(Number\(event\.target\.value\)\)\}/);
  assert.match(source, /onClick=\{\(\) => setPlayerExpanded\(value => !value\)\}/);
  assert.match(source, /loopingSceneId === null\s*\? playFocus\(selectedFocusCue\) : stopLoop\(\)/);
  assert.match(css, /\.miniPlayerActions \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.miniPlayerSettingsGrid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(source, /className="scenePlaybackSettings"/);
});
