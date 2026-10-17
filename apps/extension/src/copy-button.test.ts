import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CopyButton } from "./components/copy-button";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const key of ["window", "document", "navigator", "HTMLElement"] as const)
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const props = { label: "複製指令", copiedLabel: "已複製。", errorLabel: "無法複製" };

async function render(value = "first") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  async function update(next: string) {
    await act(async () => root.render(React.createElement(CopyButton, { ...props, value: next })));
  }
  await update(value);
  return {
    container,
    update,
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

function clipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

test("copy feedback stays in its button and restores the label without changing the reserved width", async () => {
  const writes: string[] = [];
  clipboard(async value => {
    writes.push(value);
  });
  const view = await render();
  try {
    const button = view.container.querySelector("button")!;
    await act(async () => button.click());
    assert.deepEqual(writes, ["first"]);
    assert.equal(button.querySelector('[role="status"]')?.textContent, props.copiedLabel);
    assert.equal(button.getAttribute("aria-label"), props.label);
    assert.equal(view.container.querySelector("p"), null);
    assert.equal(button.firstElementChild?.textContent, props.label);
    assert.equal(button.firstElementChild?.getAttribute("aria-hidden"), "true");
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1900));
    });
    assert.equal(button.querySelector('[role="status"]'), null);
    assert.equal(button.textContent, props.label);
  } finally {
    await view.close();
  }
});

test("changing the command clears feedback and ignores an older pending clipboard result", async () => {
  let complete = () => {};
  clipboard(
    () =>
      new Promise<void>(resolve => {
        complete = resolve;
      }),
  );
  const view = await render();
  try {
    await act(async () => view.container.querySelector("button")!.click());
    await view.update("updated");
    await act(async () => complete());
    assert.equal(view.container.querySelector('[role="status"]'), null);
    clipboard(async () => {
      throw new Error("denied");
    });
    await act(async () => view.container.querySelector("button")!.click());
    assert.equal(view.container.querySelector("button")?.title, props.errorLabel);
    assert.equal(view.container.querySelector("p"), null);
    await view.update("another command");
    assert.equal(view.container.querySelector('[role="status"]'), null);
  } finally {
    await view.close();
  }
});
