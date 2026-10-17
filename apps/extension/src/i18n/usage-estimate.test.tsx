import React, { act } from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationRequestSchema, GenerationInputEstimateSchema } from "@contextual/core";
import { GenerationEstimate } from "../components/generation-estimate";
import { ExecutionDetails } from "../components/execution-details";
import { formatUsd } from "./usage-estimate";

test("estimate switching discards stale replies; subscription and recovery stay usable", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test" });
  const replies: ((kind: "api" | "subscription" | "error") => void)[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  dom.window.setTimeout = ((fn: () => void) => {
    timers.set(++timerId, fn);
    return timerId;
  }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = id => {
    if (id !== undefined) timers.delete(id);
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    React,
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
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
            postMessage: (request: {
              id: string;
              payload: { agent: { provider: string; modelId: string } };
            }) =>
              replies.push(kind =>
                receive(
                  kind === "error"
                    ? { id: request.id, type: "error", message: "Unavailable" }
                    : {
                        id: request.id,
                        type: "generationEstimate",
                        estimate: {
                          ...request.payload.agent,
                          inputTokens: 1234,
                          inputCalls: 2,
                          billing: kind,
                          ...(kind === "api" ? { inputCostUsd: 0.0042 } : {}),
                        },
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
  const initial = GenerationRequestSchema.parse({
    id: crypto.randomUUID(),
    source: { platform: "import", title: "Dialogue" },
    profile: {
      targetLanguage: "en",
      instructionLanguage: "zh-TW",
      level: "B1",
      sceneCount: 4,
      contextualExampleCount: 2,
    },
    agent: { provider: "openai", modelId: "a" },
    backup: { enabled: false },
    cues: [{ id: "cue", startMs: 0, endMs: 1000, originalText: "Hello" }],
  });
  let payload = initial;
  const render = () =>
    root.render(<GenerationEstimate locale="zh-TW" payload={payload} available />);
  const advance = async () =>
    act(async () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    });
  try {
    await act(async () => render());
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await advance();
    payload = { ...initial, agent: { provider: "openai", modelId: "b" } };
    await act(async () => render());
    await act(async () => replies.shift()!("api"));
    assert.doesNotMatch(container.textContent!, /USD|1,234/, "old model estimate stays hidden");
    await advance();
    await act(async () => replies.shift()!("subscription"));
    assert.match(container.textContent!, /1,234/);
    assert.match(container.textContent!, /訂閱帳號/);
    assert.doesNotMatch(container.textContent!, /USD/);
    payload = { ...initial, agent: { provider: "openai", modelId: "c" } };
    await act(async () => render());
    await advance();
    await act(async () => replies.shift()!("error"));
    assert.match(container.textContent!, /仍可建立內容/);
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find(button => button.textContent === "重新估算")!
        .click(),
    );
    await advance();
    await act(async () => replies.shift()!("api"));
    assert.match(container.textContent!, /USD.*0\.0042/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("execution details keep reasoning inside output and never show subscription prices", () => {
  const execution = {
    workflowVersion: "test",
    promptVersion: "test",
    schemaVersion: "test",
    inputFingerprint: "a".repeat(64),
    provider: "openai",
    modelId: "model",
    contextWindow: 16384,
    maxOutputTokens: 4096,
    chunkPlan: [],
    calls: [
      {
        step: "generate",
        provider: "openai",
        modelId: "model",
        billing: "subscription" as const,
        at: new Date().toISOString(),
        usage: { input: 100, output: 300, reasoning: 200 },
        estimatedCostUsd: 0.01,
      },
    ],
  };
  const html = renderToStaticMarkup(<ExecutionDetails locale="zh-TW" execution={execution} />);
  assert.match(html, /輸出: 300/);
  assert.match(html, /推理（已包含在輸出）: 200/);
  assert.match(html, /訂閱帳號/);
  assert.doesNotMatch(html, /USD/);
  assert.ok(
    !GenerationInputEstimateSchema.safeParse({
      provider: "openai",
      modelId: "model",
      inputTokens: 100,
      inputCalls: 1,
      billing: "subscription",
      inputCostUsd: 0.01,
    }).success,
  );
  assert.match(formatUsd(0.0000001, "zh-TW"), /^< .*0\.000001/);
});
