import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { document } from "../../dev/reader-fixture";
import { ContextualSceneReader } from "../components/contextual-scene-reader";
import { JSDOM } from "jsdom";
import { parseSubtitles } from "@contextual/core";
import { getVideoAdapter } from "../video";
import { unifiedPlayerMessages } from "./unified-player";
import { contextualReaderMessages } from "./contextual-reader";
import { messages, type UiLocale } from "./messages";

test("reader renders original Netflix ruby below its base without model readings", () => {
  const doc = structuredClone(document);
  doc.profile.targetLanguage = "ja";
  doc.profile.level = "N3";
  doc.cues[0] = parseSubtitles(
    "WEBVTT\n\n00:00:01.000 --> 00:00:02.900\nヒカルの漫画 <ruby.under>面白え<rt>おもしれ</rt></ruby>～",
  )[0];
  doc.sections[0].pronunciations = [
    { cueId: "cue-1", segments: [{ text: doc.cues[0].originalText, reading: "おもしろい" }] },
  ];
  const html = render("zh-TW", doc);
  const dom = new JSDOM(html);
  const utterance = dom.window.document.querySelector('[data-ui="sourceUtterance"]')!;
  const ruby = utterance.querySelector("ruby")!;
  assert.ok(ruby);
  assert.equal(ruby.style.rubyPosition, "under");
  assert.equal(ruby.querySelector("rt")?.textContent, "おもしれ");
  assert.equal(ruby.firstChild?.textContent, "面白え");
  utterance.querySelectorAll("rt, rp").forEach(node => node.remove());
  assert.ok(utterance.textContent?.includes("ヒカルの漫画 面白え～"));
  assert.ok(!utterance.textContent?.includes("面白おもしれ"));
});

function render(locale: UiLocale, doc: typeof document = document): string {
  return renderToStaticMarkup(
    createElement(ContextualSceneReader, {
      document: doc,
      adapter: getVideoAdapter(doc.source.url),
      locale,
      repeat: "2",
      setRepeat: () => undefined,
      delay: 0,
      setDelay: () => undefined,
      sceneRepeat: "3",
      setSceneRepeat: () => undefined,
      sceneDelay: 1,
      setSceneDelay: () => undefined,
      playbackRate: 1,
      setPlaybackRate: () => undefined,
      onError: () => undefined,
      onNotice: () => undefined,
      onSaveRange: async () => undefined,
      onSaveSceneRange: async () => undefined,
    }),
  );
}

test("current reader keeps source and whole-sentence reading visible without interpretation modes", () => {
  const html = render("zh-TW");
  const copy = contextualReaderMessages["zh-TW"];
  assert.ok(html.includes(copy.dialogue));
  assert.ok(html.includes("I haven&#x27;t decided yet."));
  assert.ok(html.includes("整句意思"));
  assert.ok(html.includes('data-ui="inlineAnalysis"'));
  assert.ok(!html.includes('data-ui="analysis-toggle"'));
  assert.ok(!html.includes('data-ui="analysis-toggle-all"'));
  assert.ok(!html.includes("A friend asks about a trip."));
  assert.ok(html.includes(copy.previousScene) && html.includes(copy.nextScene));
  assert.ok(html.includes('data-ui="unifiedPlayer"'));
  assert.ok(!html.includes("sceneSteps"));
  assert.ok(!html.includes("<textarea"));
});

test("current reader stays localized in five UI languages and retains source-only dialogue", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const html = render(locale);
    const copy = contextualReaderMessages[locale];
    assert.ok(html.includes(copy.dialogue), locale);
    assert.ok(html.includes(copy.playScene), locale);
    assert.ok(html.includes('aria-label="' + unifiedPlayerMessages[locale].loop + '"'), locale);
    assert.ok(html.includes(copy.playCue + " 1"), locale);
    assert.ok(html.includes(copy.previousScene), locale);
    assert.ok(html.includes("What about dinner?"), locale);
    assert.ok(html.includes('role="combobox"'), locale);
  }
  const importOnly = render("en", {
    ...document,
    source: { platform: "import", title: "Imported" },
  });
  assert.ok(!importOnly.includes("z-[5]"), "import-only lessons have no sticky contextual player");
});

test("current reader puts pronunciation settings in its header and renders only aligned saved readings", () => {
  const japanese = {
    ...document,
    profile: { ...document.profile, targetLanguage: "ja" as const, level: "N4" },
    cues: [{ ...document.cues[0], originalText: "昨日" }, ...document.cues.slice(1)],
    sections: [
      {
        ...document.sections[0],
        pronunciations: [{ cueId: "cue-1", segments: [{ text: "昨日", reading: "きのう" }] }],
      },
    ],
  };
  const html = render("zh-TW", japanese);
  assert.ok(html.includes('aria-label="發音標註"'));
  assert.match(html, /<ruby[^>]*>昨日<rp>\(<\/rp><rt[^>]*>きのう<\/rt>/);

  assert.ok(!html.includes("臺灣注音"));
  assert.ok(!html.includes(">JSON</button>"));
  const older = render("zh-TW", {
    ...japanese,
    sections: [{ ...japanese.sections[0], pronunciations: undefined }],
  });
  assert.ok(older.includes("昨日"));
  assert.ok(!older.includes("<ruby"));
});

test("current reader keeps existing Japanese kana outside ruby annotations", () => {
  const japanese = {
    ...document,
    profile: { ...document.profile, targetLanguage: "ja" as const, level: "N4" },
    cues: [{ ...document.cues[0], originalText: "面白い設定ですね。" }, ...document.cues.slice(1)],
    sections: [
      {
        ...document.sections[0],
        pronunciations: [
          {
            cueId: "cue-1",
            segments: [{ text: "面白い設定ですね。", reading: "おもしろいせっていですね" }],
          },
        ],
      },
    ],
  };
  const html = render("zh-TW", japanese);
  assert.match(html, /<ruby[^>]*>面白<rp>\(<\/rp><rt[^>]*>おもしろ<\/rt>/);
  assert.match(html, /<ruby[^>]*>設定<rp>\(<\/rp><rt[^>]*>せってい<\/rt>/);
  assert.doesNotMatch(html, /<ruby[^>]*>い<rp>/);
  assert.doesNotMatch(html, /<ruby[^>]*>ですね/);
});

test("current reader explains when the selected pronunciation has no saved readings", () => {
  const withoutReadings = render("zh-TW");
  assert.ok(withoutReadings.includes("發音標註"));
  const withReadings = render("zh-TW", {
    ...document,
    sections: [
      {
        ...document.sections[0],
        pronunciations: [
          {
            cueId: "cue-1",
            segments: [{ text: "What about dinner?", reading: "/wʌt əˈbaʊt ˈdɪnər/" }],
          },
        ],
      },
    ],
  });
  assert.ok(!withReadings.includes("本場景沒有已儲存的發音標註"));
});

test("current reader preserves cue references and requires no manual export", async () => {
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  assert.match(app, /<ContextualSceneReader/);
  assert.doesNotMatch(app, /<SceneReader/);
  const source = await readSource(
    new URL("../components/contextual-scene-reader.tsx", import.meta.url),
  );
  assert.ok(source.includes("min-h-0 flex-1 overflow-y-auto"));
  assert.ok(source.includes("<SentenceDialogue"));
  assert.match(source, /scene\.cueIds\.map\(id => cues\.get\(id\)\)/);
  assert.ok(!source.includes("<SceneFocusItems"));
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
    assert.ok(!html.includes("contextual-inline-calibration"));
    assert.ok(!html.includes(contextualReaderMessages[locale].loopCue));
  }
});
