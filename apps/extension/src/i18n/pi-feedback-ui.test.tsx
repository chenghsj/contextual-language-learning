import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PiFeedback } from "../components/pi-feedback";
import { AiModelSelection } from "../components/ai-model-selection";
import { TaskHistory } from "../components/task-history";
import { translate } from "./messages";
import { playbackTimingMessages } from "./playback-timing";

const noop = () => {};
function documentFor(node: React.ReactNode) {
  return new JSDOM(renderToStaticMarkup(node)).window.document;
}
test("timing completion and reset show the result without AI fallback or technical details", () => {
  for (const key of ["loopRangeSaved", "loopRangeReset"] as const) {
    const doc = documentFor(
      <PiFeedback locale="zh-TW" context="event" message={playbackTimingMessages.en[key]} />,
    );
    assert.equal(
      doc.querySelector('[role="status"]')?.textContent,
      playbackTimingMessages["zh-TW"][key],
    );
    assert.equal(doc.querySelector("details"), null);
  }
});
test("unknown prompt requirements are visible and raw diagnostic text is escaped", () => {
  const doc = documentFor(
    <PiFeedback
      locale="ja"
      context="prompt"
      message={"Custom requirements <script>alert(1)</script>"}
    />,
  );
  assert.match(doc.querySelector("p")!.textContent!, /指示に従って/);
  assert.equal(doc.querySelector("details")?.open, true);
  assert.equal(doc.querySelector("script"), null);
  assert.match(doc.querySelector("details")!.textContent!, /<script>/);
});
test("model loading failures use localized explanation with expandable provider diagnostics", () => {
  const doc = documentFor(
    <AiModelSelection
      locale="zh-TW"
      id="test"
      provider="openai"
      modelId=""
      available
      busy={false}
      providers={[{ id: "openai", label: "OpenAI", installed: true }]}
      models={[]}
      notice="A new remote model catalog failure"
      onProvider={noop}
      onModel={noop}
      onRefresh={noop}
    />,
  );
  assert.match(doc.querySelector('[data-ui="piFeedback"] > p')!.textContent!, /無法載入 AI 模型/);
  assert.equal(doc.querySelector("details")?.open, false);
  assert.match(doc.querySelector("details")!.textContent!, /new remote model catalog failure/);
});
test("persisted task failures follow current language without altering stored errors", () => {
  const raw = "HTTP 429 rate limit";
  const doc = documentFor(
    <TaskHistory
      locale="ko"
      jobs={[
        {
          id: "job",
          provider: "openai",
          sourceTitle: "Video",
          status: "failed",
          completed: 1,
          total: 3,
          error: raw,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]}
      loadingJobs={false}
      hostReady
      generating={false}
      storageBusy={false}
      agentCatalog={[]}
      t={(key, params) => translate("ko", key, params)}
      onRefresh={noop}
      onResume={noop}
      onOpen={noop}
      onRetryPublication={async () => {}}
      onRetryBackup={async () => {}}
    />,
  );
  assert.match(doc.querySelector('[data-ui="piFeedback"] > p')!.textContent!, /요청 한도/);
  assert.match(doc.querySelector("details")!.textContent!, /HTTP 429 rate limit/);
});
