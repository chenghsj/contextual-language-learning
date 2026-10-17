import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { settingsLayoutCopy } from "./settings-layout";
import { VideoLibrary } from "../components/video-library";
import { GenerationStatus } from "../components/generation-status";
import { translate } from "./messages";
import { sidePanelLayoutCopy } from "./side-panel-layout";

const noop = () => undefined;
test("lesson cards show actual content counts and omit pipeline and storage labels", () => {
  const html = renderToStaticMarkup(
    <VideoLibrary
      localLessons={[
        {
          documentId: "lesson",
          title: "Episode 12",
          createdAt: "2026-09-30T00:00:00Z",
          sourceKey: "video",
          targetLanguage: "ja",
          level: "N3",
          sceneCount: 4,
          expressionCount: 8,
        },
      ]}
      cloudLessons={[]}
      driveAccounts={[]}
      driveConfigured={false}
      lessonsBusy={false}
      catalogError=""
      restoreBusy={null}
      generating={false}
      storageBusy={false}
      uiLocale="zh-TW"
      t={(key, params) => translate("zh-TW", key, params)}
      onRefresh={noop}
      onConnectDrive={async () => {}}
      onOpen={noop}
      onRestore={async () => {}}
    />,
  );
  assert.match(html, /日語 · N3/);
  assert.match(html, /4 個場景.*8 個表達/);
  assert.match(html, /尚未開始學習/);
  assert.doesNotMatch(html, /OpenAI|Checkpoint|本地|雲端副本|備份中/);
});
test("progress screen has a library exit and real phases without generation settings", () => {
  const html = renderToStaticMarkup(
    <GenerationStatus
      locale="zh-TW"
      job={{
        id: "job",
        provider: "openai",
        sourceTitle: "Episode 13",
        status: "running",
        phase: "creating",
        completed: 3,
        total: 5,
        createdAt: "2026-09-30T00:00:00Z",
        updatedAt: "2026-09-30T00:00:00Z",
      }}
      title="Episode 13"
      progress=""
      notificationsEnabled
      onLibrary={noop}
      onActivity={noop}
      onCancel={noop}
    />,
  );
  const dom = new JSDOM(html);
  try {
    const ui = sidePanelLayoutCopy["zh-TW"];
    const section = dom.window.document.querySelector("section")!;
    assert.equal(section.getAttribute("aria-label"), ui.generationTitle);
    assert.deepEqual(
      [...section.querySelectorAll("ol li")].map(item => item.textContent),
      [ui.analyzing, ui.selecting, ui.creating, ui.saving],
    );
    assert.equal(section.querySelector(".animate-spin")?.parentElement?.textContent, ui.creating);
    assert.ok(section.textContent?.includes(settingsLayoutCopy["zh-TW"].runningNotify));
    assert.ok(
      [...section.querySelectorAll("button")].some(button => button.textContent === ui.backLibrary),
    );
    assert.equal(section.querySelector('[role="combobox"]'), null);
    assert.doesNotMatch(section.textContent!, /API Key|Native Host/);
  } finally {
    dom.window.close();
  }
});
test("all layout copy has the same non-empty keys in every supported locale", () => {
  const expected = Object.keys(sidePanelLayoutCopy.en).sort();
  for (const copy of Object.values(sidePanelLayoutCopy)) {
    assert.deepEqual(Object.keys(copy).sort(), expected);
    for (const value of Object.values(copy)) assert.ok(value.trim());
  }
});
