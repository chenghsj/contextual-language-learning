import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LearningDocument } from "@immersive/core";
import { ContextualSceneReader } from "../components/contextual-scene-reader";
import { getVideoAdapter } from "../video";
import { contextualReaderMessages } from "./contextual-reader";
import { messages, type UiLocale } from "./messages";

const document: Extract<LearningDocument, { schemaVersion: 3 }> = {
  schemaVersion: 3, id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-26T00:00:00.000Z",
  source: { platform: "youtube", title: "An original video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
  profile: { targetLanguage: "en", instructionLanguage: "zh-TW", level: "B1",
    mode: "adaptive", maxNewVocabulary: 2, exerciseCount: 0, sceneCount: 2,
    contextualExampleCount: 2 },
  generation: { provider: "claude", modelId: "" },
  cues: [
    { id: "cue-1", startMs: 1000, endMs: 2900, originalText: "What about dinner?" },
    { id: "cue-2", startMs: 3100, endMs: 5500, originalText: "I haven't decided yet." },
    { id: "cue-3", startMs: 5600, endMs: 7500, originalText: "Let's decide tomorrow." },
  ],
  sections: [{
    id: "00000000-0000-4000-8000-000000000002",
    title: "Dinner plans", context: "Someone is asked about dinner and has not decided.",
    learningGoal: "Discuss an undecided plan.",
    cueIds: ["cue-1", "cue-2", "cue-3"], focusCueIds: ["cue-2"],
    startMs: 1000, endMs: 7500,
    translations: [
      { cueId: "cue-1", text: "晚餐怎麼辦？" },
      { cueId: "cue-2", text: "還沒決定。" },
      { cueId: "cue-3", text: "明天再決定。" },
    ],
    vocabulary: [{ expression: "I haven't decided yet.", meaning: "我還沒決定。",
      explanation: "The question and reply show an undecided plan.", example: "I haven't decided yet." }],
    insights: [], exercises: [],
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
    playbackRate: 1, setPlaybackRate: () => undefined,
    onError: () => undefined, onDownload: () => undefined,
  }));
}

test("V3 reader presents original dialogue first, then focus, word notes and one contextual example", () => {
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
  assert.match(html, /<details[^>]*class="[^"]*my-\[11px\]/, "word notes retain their on-demand styling");
  assert.ok(html.includes(copy.previousCue) && html.includes(copy.nextCue));
  assert.ok(html.includes(copy.loopCue));
  assert.ok(html.includes('aria-pressed="true"'), "selected source cue has accessible state");
  assert.ok(!html.includes("sceneSteps"), "V3 has no mandatory learning steps");
  assert.ok(!html.includes("<textarea"), "V3 has no sentence-building answer form");
});

test("V3 reader stays localized in five UI languages and retains source-only dialogue", () => {
  for (const locale of Object.keys(messages) as UiLocale[]) {
    const html = render(locale);
    const copy = contextualReaderMessages[locale];
    assert.ok(html.includes(copy.dialogue), locale);
    assert.ok(html.includes(copy.playScene), locale);
    assert.ok(html.includes(copy.aiExamples), locale);
    assert.ok(html.includes(copy.previousScene), locale);
    assert.ok(html.includes("What about dinner?"), locale);
    assert.ok(html.includes('role="combobox"'), locale);
  }
  const importOnly = render("en", { ...document, source: { platform: "import", title: "Imported" } });
  assert.ok(!importOnly.includes('z-[5]'), "import-only lessons have no sticky contextual player");
});

test("V3 route keeps V2 unchanged, original cue refs and export actions available", async () => {
  const app = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /document\.schemaVersion === 3 \? <ContextualSceneReader/);
  assert.match(app, /document\.schemaVersion === 2 \? <SceneReader/);
  const source = await readFile(new URL("../components/contextual-scene-reader.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("sticky bottom-0"));
  assert.ok(source.includes("focus-visible:outline-2"));
  assert.match(source, /scene\.cueIds\.map\(id => cues\.get\(id\)\)/);
  assert.match(source, /item\.sourceCueIds/);
  assert.match(source, /onDownload\("json"\)/);
  assert.match(source, /onDownload\("md"\)/);
});

test("V3 follows actual playback time while keeping A/B edits per source cue", async () => {
  const source = await readFile(new URL("../components/contextual-scene-reader.tsx", import.meta.url), "utf8");
  assert.match(source, /playingCueAt\(scene\.cueIds, cues, ms\)/);
  assert.match(source, /aria-current=\{playing \? "true" : undefined\}/);
  assert.match(source, /const resumeLoop = !!loopingCueRef\.current/);
  assert.match(source, /await stopPreviousLoop\(\)/);
  assert.match(source, /const loopKey = "sceneLoopRanges:" \+ document\.id/);
  assert.match(source, /readLoopWindows\(saved\[loopKey\], document\.cues\.map/);
  assert.match(source, /\[loopKey\]: loopRanges/);
  assert.match(source, /loopRanges\[selectedCue\.id\] \?\? cuePlaybackWindow/);
  assert.match(source, /adapter\.status\(sourceUrl\)/);
  assert.match(source, /updateRange\(boundary, "current"\)/);
  assert.match(source, /updateRange\("reset"\)/);
  assert.match(source, /formatLoopTimestamp\(point\)/);
  assert.match(source, /calibrationRef\.current/);
  assert.ok(source.includes("backdrop:bg-[#0008]"));
  const html = render("zh-TW");
  assert.ok(html.includes(contextualReaderMessages["zh-TW"].adjustPosition));
  assert.ok(html.includes("<dialog"));
  assert.ok(!html.includes("<dialog open"), "calibration opens only when requested");
});
