import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { AiModelSelection } from "../components/ai-model-selection";
import { PiSettings } from "../components/pi-settings";
import { TaskHistory } from "../components/task-history";
import { piCopy } from "./pi";
import { translate } from "./messages";
import { modelAvailabilityCopy } from "./model-availability";

const noop = () => undefined;
function picker(provider: string, available = true, busy = false) {
  return new JSDOM(
    renderToStaticMarkup(
      <AiModelSelection
        locale="zh-TW"
        id="create"
        provider={provider}
        modelId="saved-model"
        available={available}
        busy={busy}
        notice=""
        providers={[
          { id: "openai", label: "OpenAI", installed: true },
          { id: "google", label: "Google", installed: false },
        ]}
        models={[]}
        onProvider={noop}
        onModel={noop}
        onRefresh={noop}
      />,
    ),
  ).window.document;
}
test("model picker keeps stored selection visible and disables it while loading or host unavailable", () => {
  const doc = picker("openai");
  assert.match(doc.querySelector("#create-model")!.textContent!, /saved-model/);
  assert.equal(doc.querySelector("#create-model")!.hasAttribute("disabled"), true);
  assert.equal(
    picker("openai", true, true).querySelector("#create-model")!.hasAttribute("disabled"),
    true,
  );
  assert.equal(
    picker("openai", false).querySelector("#create-service")!.hasAttribute("disabled"),
    true,
  );
  assert.equal(doc.querySelector('label[for="create-model"]')!.textContent, piCopy["zh-TW"].model);
});
test("disconnected service cannot choose a model and directs users to settings", () => {
  const doc = picker("google");
  assert.equal(doc.querySelector("#create-model"), null);
  assert.match(doc.querySelector("#create-service")!.textContent!, /未連接/);
  assert.match(doc.body.textContent!, /請到設定連接 AI 服務/);
  assert.equal(
    [...doc.querySelectorAll("button")].some(
      button => button.textContent === piCopy["zh-TW"].connect,
    ),
    false,
  );
});

test("connected services without text models explain why generation cannot proceed", () => {
  const doc = new JSDOM(
    renderToStaticMarkup(
      <AiModelSelection
        locale="zh-TW"
        id="classifier"
        provider="typesafe"
        modelId=""
        providers={[{ id: "typesafe", label: "TypeSafe", installed: true }]}
        models={[]}
        available
        busy={false}
        notice=""
        onProvider={noop}
        onModel={noop}
        onRefresh={noop}
      />,
    ),
  ).window.document;
  assert.match(doc.body.textContent!, /沒有可用的文字生成模型/);
  assert.equal(doc.querySelector("#classifier-model")!.hasAttribute("disabled"), true);
  assert.equal(doc.querySelector("#classifier-service")!.hasAttribute("disabled"), false);
});
test("unavailable host explains missing service rows", () => {
  const html = renderToStaticMarkup(
    <PiSettings
      locale="zh-TW"
      available={false}
      selectedProvider=""
      onSelect={noop}
      onChanged={noop}
    />,
  );
  assert.match(html, /請先檢查或更新/);
  assert.doesNotMatch(html, /尚未驗證|官方授權|登入帳號/);
});
function history(provider: string, connected: boolean, documentId?: string) {
  const now = new Date().toISOString();
  return renderToStaticMarkup(
    <TaskHistory
      locale="zh-TW"
      jobs={[
        {
          id: "task",
          provider,
          sourceTitle: "Example",
          status: "failed",
          completed: 0,
          total: 1,
          createdAt: now,
          updatedAt: now,
          documentId,
        },
      ]}
      loadingJobs={false}
      hostReady
      generating={false}
      storageBusy={false}
      agentCatalog={[{ id: provider, label: provider, installed: connected }]}
      t={(key, params) => translate("zh-TW", key, params)}
      onConfigure={noop}
      onRefresh={noop}
      onResume={noop}
      onOpen={noop}
      onRetryPublication={async () => {}}
      onRetryBackup={async () => {}}
    />,
  );
}
test("history preserves old results without offering invalid CLI resume", () => {
  const html = history("custom-old-cli", true, "saved-document");
  assert.match(html, /舊版 CLI 任務無法續跑/);
  assert.match(html, /開啟教材/);
  assert.doesNotMatch(html, /繼續生成/);
});
test("SDK history offers connection first, and resume only for connected services", () => {
  assert.match(history("openai", false), /連接服務/);
  assert.doesNotMatch(history("openai", false), /繼續生成/);
  assert.match(history("openai", true), /繼續生成/);
});
test("all locales use product connection copy and expose new UI states", () => {
  for (const ui of Object.values(piCopy)) {
    for (const value of Object.values(ui)) assert.ok(value.trim());
    assert.doesNotMatch(ui.hint, /SDK|CLI|JSON/);
    assert.doesNotMatch(ui.done, /verified|驗證|验证|未検証|검증/);
  }
});

test("model refresh shows progress and returns to its action without a success notice", () => {
  const props = {
    locale: "zh-TW" as const,
    id: "refresh",
    provider: "openai",
    modelId: "",
    providers: [{ id: "openai", label: "OpenAI", installed: true }],
    models: [],
    available: true,
    notice: "",
    onProvider: noop,
    onModel: noop,
    onRefresh: noop,
  };
  const loading = new JSDOM(renderToStaticMarkup(<AiModelSelection {...props} busy />)).window
    .document;
  const button = loading.querySelector('button[aria-busy="true"]')!;
  assert.equal(button.hasAttribute("disabled"), true);
  assert.ok(button.querySelector(".animate-spin"));
  assert.doesNotMatch(loading.body.textContent!, /模型已更新/);
  const complete = new JSDOM(renderToStaticMarkup(<AiModelSelection {...props} busy={false} />))
    .window.document;
  assert.equal(complete.querySelector('button[aria-live="polite"]')!.textContent, "重新整理模型");
  assert.doesNotMatch(complete.body.textContent!, /模型已更新/);
});

test("Antigravity selection distinguishes a checked catalog, unknown cache, and retired selection in every locale", () => {
  for (const locale of Object.keys(
    modelAvailabilityCopy,
  ) as (keyof typeof modelAvailabilityCopy)[]) {
    const props = {
      locale,
      id: "availability",
      provider: "antigravity",
      modelId: "gemini-3.8-flash",
      providers: [{ id: "antigravity", label: "Google Antigravity", installed: true }],
      available: true,
      busy: false,
      notice: "",
      onProvider: noop,
      onModel: noop,
      onRefresh: noop,
    };
    const model = { id: props.modelId, label: "Gemini 3.8 Flash" };
    const render = (models: Parameters<typeof AiModelSelection>[0]["models"], extra = {}) =>
      new JSDOM(renderToStaticMarkup(<AiModelSelection {...props} models={models} {...extra} />))
        .window.document;
    assert.equal(
      render([{ ...model, availability: "listed" }]).querySelector('[data-ui="modelAvailability"]')!
        .textContent,
      modelAvailabilityCopy[locale].listed,
    );
    for (const models of [[model], [{ ...model, availability: "unknown" as const }]])
      assert.equal(
        render(models).querySelector('[data-ui="modelAvailability"]')!.textContent,
        modelAvailabilityCopy[locale].unknown,
      );
    assert.equal(
      render([{ ...model, availability: "listed" }], { warning: "HTTP 503" }).querySelector(
        '[data-ui="modelAvailability"]',
      )!.textContent,
      modelAvailabilityCopy[locale].unknown,
    );
    const stale = render([{ id: "replacement", label: "Replacement" }]);
    assert.ok(
      stale
        .querySelector("#availability-model")!
        .textContent!.includes(modelAvailabilityCopy[locale].unavailable),
    );
    assert.ok(stale.body.textContent!.includes(piCopy[locale].stale));
    assert.equal(stale.querySelector('[data-ui="modelAvailability"]'), null);
    const failedRefresh = render([{ id: "replacement", label: "Replacement" }], {
      warning: "HTTP 503",
    });
    assert.equal(
      failedRefresh.querySelector('[data-ui="modelAvailability"]')!.textContent,
      modelAvailabilityCopy[locale].unknown,
    );
    assert.ok(!failedRefresh.body.textContent!.includes(piCopy[locale].stale));
    assert.ok(
      !failedRefresh
        .querySelector("#availability-model")!
        .textContent!.includes(modelAvailabilityCopy[locale].unavailable),
    );
    assert.equal(
      render([model], { busy: true }).querySelector('[data-ui="modelAvailability"]'),
      null,
    );
  }
});
