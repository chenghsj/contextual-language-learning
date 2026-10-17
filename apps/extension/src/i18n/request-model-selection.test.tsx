import React, { act } from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import type { AgentSettings } from "@contextual/core";
import { RequestModelSelection } from "../components/request-model-selection";

test("request readiness follows the current catalog and reasoning, retaining controls during refresh", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test" });
  const replies: ((failed?: boolean, warning?: string) => void)[] = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    React,
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    Event: dom.window.Event,
    DocumentFragment: dom.window.DocumentFragment,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      runtime: {
        connect: () => {
          let receive: (message: unknown) => void;
          return {
            onMessage: {
              addListener: (listener: typeof receive) => {
                receive = listener;
              },
            },
            onDisconnect: { addListener() {} },
            disconnect() {},
            postMessage: (request: { id: string }) =>
              replies.push((failed, warning) =>
                receive(
                  failed
                    ? { id: request.id, type: "error", message: "Catalog unavailable" }
                    : {
                        id: request.id,
                        type: "agentModels",
                        models: [
                          {
                            id: "denied",
                            label: "Denied model",
                            thinkingLevels: ["high"],
                            disabled: true,
                          },
                          { id: "model", label: "Model", thinkingLevels: ["low", "high"] },
                          { id: "other", label: "Other model", thinkingLevels: ["low"] },
                        ],
                        source: "sdk",
                        ...(warning ? { warning } : {}),
                      },
                ),
              ),
          };
        },
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let ready = false;
  const onReady = (value: boolean) => {
    ready = value;
  };
  let selected: AgentSettings = { provider: "openai", modelId: "model", thinkingLevel: "high" };
  let available = true;
  let installed = true;
  const render = () =>
    root.render(
      <RequestModelSelection
        locale="zh-TW"
        selected={selected}
        providers={[{ id: "openai", label: "OpenAI", installed }]}
        available={available}
        onChange={() => {}}
        onReady={onReady}
        onConfigure={() => {}}
      />,
    );
  const refresh = () => container.querySelector<HTMLButtonElement>("button[aria-busy]")!;
  try {
    await act(async () => render());
    assert.equal(ready, false, "an unloaded catalog cannot enable creation");
    await act(async () => replies.shift()!());
    assert.equal(ready, true);
    await act(async () => refresh().click());
    await act(async () => replies.shift()!(false, "Synthetic refresh HTTP 503"));
    assert.equal(ready, true, "refresh warning does not prevent creation with SDK candidates");
    assert.equal(container.querySelector<HTMLButtonElement>("#request-model")!.disabled, false);
    assert.match(container.textContent!, /模型清單更新失敗，仍可選擇現有模型/);
    assert.equal(container.querySelector("#request-service"), null);
    const thinking = container.querySelector<HTMLButtonElement>("#request-thinking")!;
    await act(async () => refresh().click());
    assert.equal(ready, false);
    assert.equal(thinking.disabled, true);
    assert.equal(container.querySelector("#request-thinking"), thinking);
    assert.match(thinking.textContent!, /高/);
    await act(async () => replies.shift()!(true));
    assert.equal(ready, false, "failed refresh cannot reuse the previous valid catalog");
    await act(async () => refresh().click());
    await act(async () => replies.shift()!());
    assert.equal(ready, true);
    selected = { ...selected, thinkingLevel: "max" };
    await act(async () => render());
    assert.equal(ready, false, "unsupported reasoning cannot enable creation");
    selected = { ...selected, modelId: "denied", thinkingLevel: "high" };
    await act(async () => render());
    assert.equal(ready, false, "a visible disabled model cannot enable creation");
    assert.match(container.querySelector("#request-model")!.textContent!, /Denied model.*不可用/);
    assert.equal(container.querySelector<HTMLButtonElement>("#request-thinking")!.disabled, true);
    selected = { ...selected, modelId: "missing", thinkingLevel: undefined };
    await act(async () => render());
    assert.equal(ready, false, "a stale model cannot enable creation");
    selected = { ...selected, modelId: "", thinkingLevel: "low" };
    await act(async () => render());
    assert.equal(ready, true, "automatic selection validates the first available model");
    installed = false;
    await act(async () => render());
    assert.equal(ready, false, "disconnecting the service invalidates readiness");
    installed = true;
    available = false;
    await act(async () => render());
    assert.equal(ready, false, "an unavailable Host cannot enable creation");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
