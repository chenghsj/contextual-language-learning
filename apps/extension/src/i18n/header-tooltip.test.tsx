import React, { act } from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { HeaderActions } from "../components/header-actions";
import { restoreFocusWithoutTooltip } from "../components/icon-tooltip";

test("both header icons show localized tooltips on keyboard focus and dismiss with Escape", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://extension.test" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const clicked: string[] = [];
  try {
    await act(async () =>
      root.render(
        <HeaderActions
          locale="zh-TW"
          page="create"
          onActivity={() => clicked.push("activity")}
          onSettings={() => clicked.push("settings")}
        />,
      ),
    );
    const icons = container.querySelectorAll<HTMLButtonElement>("button");
    for (const [index, label] of ["活動", "設定"].entries()) {
      await act(async () => restoreFocusWithoutTooltip(icons[index]));
      assert.equal(dom.window.document.activeElement, icons[index]);
      assert.equal(container.querySelector('[role="tooltip"]'), null);
      await act(async () =>
        icons[index].dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })),
      );
      assert.match(container.querySelector('[role="tooltip"]')!.textContent!, new RegExp(label));
      await act(async () =>
        icons[index].dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })),
      );
      assert.equal(container.querySelector('[role="tooltip"]'), null);
      await act(async () => icons[index].blur());
      await act(async () => {
        dom.window.document.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
        );
        icons[index].focus();
      });
      const tooltip = container.querySelector('[role="tooltip"]')!;
      assert.match(tooltip.textContent!, new RegExp(label));
      assert.equal(icons[index].getAttribute("aria-describedby"), tooltip.id);
      await act(async () =>
        icons[index].dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      assert.equal(container.querySelector('[role="tooltip"]'), null);
      await act(async () => icons[index].click());
    }
    assert.deepEqual(clicked, ["activity", "settings"]);
    await act(async () =>
      root.render(
        <HeaderActions locale="ja" page="settings" onActivity={() => {}} onSettings={() => {}} />,
      ),
    );
    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
      icons[0].focus();
    });
    assert.match(container.querySelector('[role="tooltip"]')!.textContent!, /アクティビティ/);
  } finally {
    await act(async () => root.unmount());
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
