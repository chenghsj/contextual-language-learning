import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { useModelDirectory } from "../hooks/use-model-directory";

test("late catalog replies cannot cross services or reconnect with an old account's models", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const replies = new Map<string, (label: string) => void>();
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    React,
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      runtime: {
        connect() {
          let receive: (value: unknown) => void;
          return {
            onMessage: {
              addListener(fn: typeof receive) {
                receive = fn;
              },
            },
            onDisconnect: { addListener() {} },
            disconnect() {},
            postMessage(request: { id: string; provider: string }) {
              replies.set(request.provider, label =>
                receive({
                  id: request.id,
                  type: "discoveredModels",
                  source: "directory",
                  models: [{ id: label.toLowerCase(), label }],
                }),
              );
            },
          };
        },
      },
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  function Probe({ provider, available }: { provider: string; available: boolean }) {
    const result = useModelDirectory(provider, available, 0);
    return <output>{result.models.map(model => model.label).join(",")}</output>;
  }
  const root = createRoot(dom.window.document.getElementById("root")!);
  const render = async (provider: string, available = true) => {
    await act(async () => root.render(<Probe provider={provider} available={available} />));
  };
  try {
    await render("openai");
    const oldReply = replies.get("openai")!;
    await render("google");
    await act(async () => oldReply("Old"));
    assert.equal(dom.window.document.querySelector("output")!.textContent, "");
    await act(async () => replies.get("google")!("Gemini"));
    assert.equal(dom.window.document.querySelector("output")!.textContent, "Gemini");
    await render("google", false);
    await render("google");
    assert.equal(
      dom.window.document.querySelector("output")!.textContent,
      "",
      "reconnect requires fresh models",
    );
    await act(async () => replies.get("google")!("New"));
    assert.equal(dom.window.document.querySelector("output")!.textContent, "New");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
