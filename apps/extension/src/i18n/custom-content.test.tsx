import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SafeMarkdown } from "../components/custom-viewer";
import { VideoLibrary } from "../components/video-library";
import { customContentCopy } from "./custom-content";
import { translate } from "./messages";

test("custom Markdown blocks raw HTML, executable links and remote image requests", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown
      locale="zh-TW"
      markdown={
        '# Safe\n\n<script>alert(1)</script>\n\n<iframe src="https://remote.example"></iframe>\n\n[bad](javascript:alert(1))\n\n![image](https://remote.example/image.png)\n\n[good](https://example.com)\n\n![data](data:image/svg+xml;base64,abc)'
      }
    />,
  );
  assert.match(html, /Safe/);
  assert.match(html, /已阻擋遠端圖片/);
  assert.match(html, /href="https:\/\/example.com".*rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<script|<iframe|<img|javascript:|data:image|src=/);
});

test("custom library cards have honest type/language labels and no fabricated lesson progress", () => {
  const html = renderToStaticMarkup(
    <VideoLibrary
      localLessons={[]}
      cloudLessons={[]}
      localCustom={[
        {
          kind: "custom",
          documentId: "00000000-0000-4000-8000-000000000001",
          title: "Notes",
          sourceTitle: "Source video",
          createdAt: "2026-10-03T00:00:00.000Z",
        },
      ]}
      driveAccounts={[]}
      driveConfigured={false}
      lessonsBusy={false}
      catalogError=""
      restoreBusy={null}
      generating={false}
      storageBusy={false}
      uiLocale="zh-TW"
      t={(key, params) => translate("zh-TW", key, params)}
      onRefresh={() => {}}
      onConnectDrive={async () => {}}
      onOpen={() => {}}
      onRestore={async () => {}}
      onOpenCustom={() => {}}
    />,
  );
  assert.match(html, /自訂 Markdown · 未指定語言/);
  assert.match(html, /Notes/);
  assert.doesNotMatch(html, /B1|已瀏覽|尚未開始學習|個場景/);
});

test("all custom content actions and recovery feedback are localized", () => {
  const keys = Object.keys(customContentCopy("en"));
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    const copy = customContentCopy(locale);
    assert.deepEqual(Object.keys(copy), keys);
    assert.ok(Object.values(copy).every(text => typeof text === "string" && text.trim()));
  }
});
