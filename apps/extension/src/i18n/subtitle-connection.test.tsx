import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  VideoConnectionNotice,
  VideoConnectionReloadButton,
} from "../components/video-connection-notice";
import { subtitleLayoutCopy } from "./subtitle-layout";
import type { UiLocale } from "./messages";

for (const locale of Object.keys(subtitleLayoutCopy) as UiLocale[]) {
  test(`${locale} distinguishes usable subtitles from video connection recovery`, () => {
    const copy = subtitleLayoutCopy[locale];
    const html = renderToStaticMarkup(
      <>
        <VideoConnectionNotice locale={locale} hasSubtitles failed={false} />
        <VideoConnectionReloadButton
          locale={locale}
          busy={false}
          disabled={false}
          onReload={() => {}}
        />
      </>,
    );
    assert.ok(html.includes(copy.subtitlesPreserved));
    assert.ok(!html.includes(copy.reconnectTitle));
    assert.doesNotMatch(html.split("<button")[0], /bg-muted|rounded-lg|<h3/);
    assert.ok(html.includes(copy.reloadVideo));
    assert.ok(!html.includes(copy.reloadNeeded));
    assert.doesNotMatch(html, /擴充功能已更新/);
  });
  test(`${locale} requests subtitle retrieval only when no usable subtitles exist`, () => {
    const html = renderToStaticMarkup(
      <>
        <VideoConnectionNotice locale={locale} hasSubtitles={false} failed={false} />
        <VideoConnectionReloadButton locale={locale} busy disabled={false} onReload={() => {}} />
      </>,
    );
    assert.ok(html.includes(subtitleLayoutCopy[locale].reloadNeeded));
    assert.ok(!html.includes(subtitleLayoutCopy[locale].subtitlesPreserved));
    assert.ok(html.includes(subtitleLayoutCopy[locale].reloadBusy));
    assert.match(html, /disabled=""/);
  });
}
