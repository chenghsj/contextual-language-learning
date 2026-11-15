import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { SpeechDownloadTaskSchema } from "@contextual/core";
import { SpeechDownloadFeedback } from "../components/speech-download-feedback";
import { speechDownloadTaskCopy } from "./speech-download-task";
import type { UiLocale } from "./messages";

const task = SpeechDownloadTaskSchema.parse({
  id: "d5897e10-f892-4d06-a817-f3b836696cc1",
  voice: { id: "siri:test", name: "Nora", language: "en-US", engine: "siri" },
  createdAt: "2026-10-21T02:00:00.000Z",
  updatedAt: "2026-10-21T02:00:05.000Z",
  progress: { status: "waiting-system" },
  observation: { kind: "fresh", checkedAt: "2026-10-21T02:00:05.000Z" },
});

test("active download shows compact activity feedback with the real check time in its tooltip in every locale", () => {
  const locales: UiLocale[] = ["en", "zh-TW", "zh-CN", "ja", "ko"];
  for (const locale of locales) {
    const document = new JSDOM(
      renderToStaticMarkup(<SpeechDownloadFeedback task={task} locale={locale} service="ready" />),
    ).window.document;
    const progress = document.querySelector('[role="img"]');
    assert.ok(progress);
    assert.match(progress.getAttribute("aria-label") ?? "", /Nora/);
    assert.equal(progress.getAttribute("aria-valuenow"), null);
    assert.ok(
      progress.getAttribute("aria-label")?.includes(speechDownloadTaskCopy[locale].waitingSystem),
    );
    assert.equal(
      progress.getAttribute("title"),
      `${speechDownloadTaskCopy[locale].lastChecked} ${new Date("2026-10-21T02:00:05.000Z").toLocaleString(locale)}`,
    );
    assert.equal(document.querySelector('[role="progressbar"]'), null);
    assert.equal(document.body.textContent, "");
  }
});

test("service loss keeps the last observation and says that status updates have paused", () => {
  const document = new JSDOM(
    renderToStaticMarkup(
      <SpeechDownloadFeedback task={task} locale="zh-TW" service="unavailable" />,
    ),
  ).window.document;
  assert.equal(
    document.querySelector('[role="img"]')?.getAttribute("aria-label"),
    "Nora · 狀態更新已暫停",
  );
  assert.ok(document.querySelector('[role="img"]')?.getAttribute("title")?.startsWith("最近確認 "));
  assert.equal(document.body.textContent, "");
});

test("a cancellation with no completed observation shows withdrawal and invents no check time", () => {
  const cancelling = SpeechDownloadTaskSchema.parse({
    ...task,
    progress: { status: "cancelling" },
    observation: { kind: "reconciling" },
  });
  const document = new JSDOM(
    renderToStaticMarkup(
      <SpeechDownloadFeedback task={cancelling} locale="zh-TW" service="reconciling" />,
    ),
  ).window.document;
  assert.equal(document.querySelector("time"), null);
  assert.equal(
    document.querySelector('[role="img"]')?.getAttribute("aria-label"),
    "Nora · 正在取消…",
  );
  assert.equal(document.querySelector('[role="img"]')?.getAttribute("title"), "正在取消…");
});

test("completed downloads no longer expose an in-progress indicator", () => {
  const completed = SpeechDownloadTaskSchema.parse({
    ...task,
    progress: { status: "completed", endedAt: "2026-10-21T02:00:10.000Z" },
  });
  assert.equal(
    renderToStaticMarkup(
      <SpeechDownloadFeedback task={completed} locale="zh-TW" service="ready" />,
    ),
    "",
  );
});
