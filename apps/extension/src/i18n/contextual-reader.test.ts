import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningDocument } from "@immersive/core";
import { ContextualSceneReader } from "../components/contextual-scene-reader";
import { getVideoAdapter } from "../video";
import { unifiedPlayerMessages } from "./unified-player";
import { contextualReaderMessages } from "./contextual-reader";
import { messages, type UiLocale } from "./messages";

const document: LearningDocument = {
  schemaVersion: 4, id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: { platform: "youtube", title: "An original video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
    sceneCount: 2, contextualExampleCount: 2 },
  generation: { provider: "claude", modelId: "" },
  cues: [
    { id: "cue-1", startMs: 1000, endMs: 2900, originalText: "What about dinner?" },
    { id: "cue-2", startMs: 3100, endMs: 5500, originalText: "I haven't decided yet." },
    { id: "cue-3", startMs: 5600, endMs: 7500, originalText: "Let's decide tomorrow." },
  ],
  sections: [{
    id: "00000000-0000-4000-8000-000000000002",
    title: "Dinner plans", context: "Someone is asked about dinner and has not decided.",
    cueIds: ["cue-1", "cue-2", "cue-3"],
    startMs: 1000, endMs: 7500,
    translations: [
      { cueId: "cue-1", text: "晚餐怎麼辦？" },
      { cueId: "cue-2", text: "還沒決定。" },
      { cueId: "cue-3", text: "明天再決定。" },
    ],
    focusItems: [{
      expression: "I haven't decided yet.", sourceCueIds: ["cue-2"],
      meaning: "我還沒決定。",
      contextExplanation: "The question about dinner and the tomorrow reply indicate no decision has been made.",
      contextCueIds: ["cue-1", "cue-3"],
      wordNotes: [{ surface: "yet", meaning: "尚未", explanation: "Not decided so far." }],
      examples: [
        { situation: "A friend asks about a trip.", dialogue: [
          { text: "Have you decided on a trip?", translation: "決定旅行了嗎？" },
          { text: "I haven't decided yet.", translation: "我還沒決定。" },
        ] },
        { situation: "A colleague asks about lunch.", dialogue: [
          { text: "What about lunch?", translation: "午餐呢？" },
          { text: "I haven't decided yet.", translation: "我還沒決定。" },
        ] },
      ],
    }],
  }],
};

function render(locale: UiLocale, doc: typeof document = document): string {
  return renderToStaticMarkup(createElement(ContextualSceneReader, {
    document: doc, adapter: getVideoAdapter(doc.source.url), locale,
    repeat: "2", setRepeat: () => undefined, delay: 0, setDelay: () => undefined,
    sceneRepeat: "3", setSceneRepeat: () => undefined, sceneDelay: 1, setSceneDelay: () => undefined,
    playbackRate: 1, setPlaybackRate: () => undefined,
    onError: () => undefined, onNotice: () => undefined,
    onSaveRange: async () => undefined,
    onSaveSceneRange: async () => undefined,
  }));
}

test("V4 reader presents original dialogue first, then focus, word notes and one contextual example", () => {
  const html = render("zh-TW");
  const copy = contextualReaderMessages["zh-TW"];
  assert.ok(html.indexOf(copy.dialogue) < html.indexOf(copy.focus));
  assert.ok(html.includes(copy.context));
  assert.ok(html.includes("I haven&#x27;t decided yet."));
  assert.ok(html.includes(copy.aiExamples));
  assert.ok(html.includes("A friend asks about a trip."));
  assert.ok(!html.includes("A colleague asks about lunch."), "only one contextual example visible by default");
  assert.ok(html.includes(copy.anotherExamples.replace("{count}", "1")));
  assert.ok(html.includes(copy.words), "essential word notes are available on demand");
  assert.match(html, /data-state="closed"/, "word notes use collapsible sections");
  assert.ok(html.includes(copy.previousScene) && html.includes(copy.nextScene));
  assert.ok(html.includes('data-ui="unifiedPlayer"'));
  assert.ok(!html.includes("sceneSteps"), "V4 has no mandatory learning steps");
  assert.ok(!html.includes("<textarea"), "V4 has no sentence-building answer form");
});

test("V4 reader stays localized in five UI languages and retains source-only dialogue", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const html = render(locale);
    const copy = contextualReaderMessages[locale];
    assert.ok(html.includes(copy.dialogue), locale);
    assert.ok(html.includes(copy.playScene), locale);
    assert.ok(html.includes('aria-label="' + unifiedPlayerMessages[locale].loop + '"'), locale);
    assert.ok(html.includes(copy.aiExamples), locale);
    assert.ok(html.includes(copy.previousScene), locale);
    assert.ok(html.includes("What about dinner?"), locale);
    assert.ok(html.includes('role="combobox"'), locale);
  }
  const importOnly = render("en", { ...document, source: { platform: "import", title: "Imported" } });
  assert.ok(!importOnly.includes('z-[5]'), "import-only lessons have no sticky contextual player");
});

test("V4 reader puts pronunciation settings in its header and renders only aligned saved readings", () => {
  const japanese = {
    ...document,
    profile: { ...document.profile, targetLanguage: "ja" as const, level: "N4" },
    cues: [{ ...document.cues[0], originalText: "昨日" }, ...document.cues.slice(1)],
    sections: [{ ...document.sections[0], pronunciations: [
      { cueId: "cue-1", segments: [{ text: "昨日", reading: "きのう" }] },
    ] }],
  };
  const html = render("zh-TW", japanese);
  assert.ok(html.includes('aria-label="發音標註"'));
  assert.match(html, /<ruby[^>]*>昨日<rp>\(<\/rp><rt[^>]*>きのう<\/rt>/);

  assert.ok(!html.includes("臺灣注音"));
  assert.ok(!html.includes(">JSON</button>"));
  const older = render("zh-TW", { ...japanese, sections: [{ ...japanese.sections[0], pronunciations: undefined }] });
  assert.ok(older.includes("昨日"));
  assert.ok(!older.includes("<ruby"));
});

test("V4 reader keeps existing Japanese kana outside ruby annotations", () => {
  const japanese = {
    ...document,
    profile: { ...document.profile, targetLanguage: "ja" as const, level: "N4" },
    cues: [{ ...document.cues[0], originalText: "面白い設定ですね。" }, ...document.cues.slice(1)],
    sections: [{ ...document.sections[0], pronunciations: [
      { cueId: "cue-1", segments: [{ text: "面白い設定ですね。", reading: "おもしろいせっていですね" }] },
    ] }],
  };
  const html = render("zh-TW", japanese);
  assert.match(html, /<ruby[^>]*>面白<rp>\(<\/rp><rt[^>]*>おもしろ<\/rt>/);
  assert.match(html, /<ruby[^>]*>設定<rp>\(<\/rp><rt[^>]*>せってい<\/rt>/);
  assert.doesNotMatch(html, /<ruby[^>]*>い<rp>/);
  assert.doesNotMatch(html, /<ruby[^>]*>ですね/);
});

test("V4 reader explains when the selected pronunciation has no saved readings", () => {
  const withoutReadings = render("zh-TW");
  assert.ok(withoutReadings.includes("發音標註"));
  const withReadings = render("zh-TW", {
    ...document,
    sections: [{ ...document.sections[0], pronunciations: [
      { cueId: "cue-1", segments: [{ text: "What about dinner?", reading: "/wʌt əˈbaʊt ˈdɪnər/" }] },
    ] }],
  });
  assert.ok(!withReadings.includes("本場景沒有已儲存的發音標註"));
});

test("V4 reader preserves cue references and requires no manual export", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /<ContextualSceneReader/);
  assert.doesNotMatch(app, /<SceneReader/);
  const source = await readFile(new URL("../components/contextual-scene-reader.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("min-h-0 flex-1 overflow-y-auto"));
  assert.ok(source.includes("return <Button key={cue.id}"));
  assert.match(source, /scene\.cueIds\.map\(id => cues\.get\(id\)\)/);
  assert.ok(source.includes("<SceneFocusItems"));
  const manifest = await readFile(new URL("../../public/manifest.json", import.meta.url), "utf8");
  assert.ok(!source.includes("onDownload"));
  assert.ok(!app.includes("downloadSavedDocument"));
  assert.ok(!app.includes("chrome.downloads"));
  assert.ok(!JSON.parse(manifest).permissions.includes("downloads"));
});

test("unified reader has one player, contextual navigation and advanced timing entry", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const html = render(locale);
    assert.equal((html.match(/data-ui="unifiedPlayer"/g) ?? []).length, 1);
    assert.ok(html.includes('aria-label="' + unifiedPlayerMessages[locale].options + '"'));
    assert.ok(html.includes('aria-label="' + unifiedPlayerMessages[locale].play + '"'));
    assert.ok(!html.includes('contextual-inline-calibration'));
    assert.ok(!html.includes(contextualReaderMessages[locale].loopCue));
  }
});
