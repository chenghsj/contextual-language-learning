import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://extension.test",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "NodeFilter",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
const stored = new Map<string, unknown>();
let failWrite = false,
  writes = 0;
const database = {
  createObjectStore() {},
  transaction() {
    const transaction = {
      error: new Error("disk unavailable"),
      oncomplete: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      objectStore() {
        return {
          get(key: string) {
            const request = {
              result: stored.get(key),
              onsuccess: undefined as (() => void) | undefined,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put(value: unknown, key: string) {
            writes++;
            queueMicrotask(() => {
              if (failWrite) transaction.onerror?.();
              else {
                stored.set(key, structuredClone(value));
                transaction.oncomplete?.();
              }
            });
          },
        };
      },
    };
    return transaction;
  },
};
Object.defineProperty(globalThis, "indexedDB", {
  configurable: true,
  value: {
    open() {
      const request = {
        result: database,
        onupgradeneeded: undefined as (() => void) | undefined,
        onsuccess: undefined as (() => void) | undefined,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  },
});
let confirms = 0;
dom.window.confirm = () => {
  confirms++;
  return false;
};
const React = await import("react");
const { act, useState } = React;
const { createRoot } = await import("react-dom/client");
const { CustomPrompt } = await import("../components/custom-prompt");
const { promptTemplates } = await import("./custom-content");
const { promptTemplateCopy } = await import("./prompt-templates");
const { builtinPrompt } = await import("./builtin-prompts");
import type { UiLocale } from "./messages";

async function mount(initial = "My unsaved Prompt", locale: UiLocale = "zh-TW") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const [prompt, onPrompt] = useState(initial);
    return (
      <CustomPrompt
        locale={locale}
        prompt={prompt}
        onPrompt={onPrompt}
        context={{ title: true, subtitles: true }}
        onContext={() => {}}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  return {
    container,
    setLocale: async (next: UiLocale) => {
      locale = next;
      await act(async () => root.render(<Harness />));
    },
    prompt: () => container.querySelector("textarea")!.value,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
function button(text: string, scope: ParentNode = document) {
  const element = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    el => (el.getAttribute("aria-label") ?? el.textContent)?.trim() === text,
  );
  assert.ok(element, "Missing button: " + text);
  return element;
}
async function click(text: string, scope: ParentNode = document) {
  await act(async () => button(text, scope).click());
  // Radix restores focus after the closing render commits.
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      input.tagName === "TEXTAREA"
        ? dom.window.HTMLTextAreaElement.prototype
        : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function choose(name: string, container: HTMLElement) {
  await act(async () => {
    const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
    trigger.focus();
    trigger.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    el => el.textContent?.trim() === name,
  );
  assert.ok(option, "Missing option: " + name);
  await act(async () =>
    option.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
}
function dialog() {
  const element = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(element);
  return element;
}

test("selecting templates never opens native confirmation and undo restores the prior Prompt", async () => {
  stored.clear();
  confirms = 0;
  const view = await mount();
  try {
    await choose("摘要", view.container);
    assert.equal(view.prompt(), builtinPrompt("summary", "zh-TW"));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await choose("文法", view.container);
    assert.equal(confirms, 0);
    await click("復原", view.container);
    assert.equal(view.prompt(), builtinPrompt("summary", "zh-TW"));
    await type(view.container.querySelector("textarea")!, "Edited prompt");
    await choose("測驗", view.container);
    await click("復原", view.container);
    assert.equal(view.prompt(), "Edited prompt");
  } finally {
    await view.close();
  }
});

test("new template cancel preserves Prompt; saving selects it; management edits and deletes it", async () => {
  stored.clear();
  failWrite = false;
  const view = await mount();
  try {
    await click("新增範本", view.container);
    assert.equal(document.activeElement === dialog().querySelector("input"), true);
    assert.equal(dialog().querySelector("textarea")!.value, "My unsaved Prompt");
    assert.equal(button("儲存範本", dialog()).disabled, true);
    await type(dialog().querySelector("input")!, "Discarded");
    await type(dialog().querySelector("textarea")!, "Discarded Prompt");
    await click("取消", dialog());
    assert.equal(document.activeElement === button("新增範本", view.container), true);
    assert.equal(view.prompt(), "My unsaved Prompt");
    assert.equal(stored.has("prompt-templates"), false);
    await click("新增範本", view.container);
    await type(dialog().querySelector("input")!, "My template");
    await type(dialog().querySelector("textarea")!, "Template body");
    await click("儲存範本", dialog());
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(view.prompt(), "Template body");
    assert.ok(
      view.container.querySelector('[role="combobox"]')?.textContent?.includes("My template"),
    );
    await click("範本管理", view.container);
    await click("修改 · My template", view.container);
    await type(dialog().querySelector("input")!, "Renamed");
    await type(dialog().querySelector("textarea")!, "Updated body");
    await click("儲存變更", dialog());
    assert.equal(view.prompt(), "Updated body");
    assert.deepEqual(
      (stored.get("prompt-templates") as { name: string; prompt: string }[]).map(
        ({ name, prompt }) => ({ name, prompt }),
      ),
      [{ name: "Renamed", prompt: "Updated body" }],
    );
    assert.ok(!view.container.textContent?.includes("已儲存"));
    await click("刪除 · Renamed", view.container);
    await click("刪除", dialog());
    assert.equal(document.activeElement === button("新增範本", view.container), true);
    assert.deepEqual(stored.get("prompt-templates"), []);
    assert.equal(view.prompt(), "Updated body");
    assert.equal(confirms, 0);
  } finally {
    await view.close();
  }
});

test("failed saves retain dialog input and allow retry without creating duplicate templates", async () => {
  stored.clear();
  failWrite = true;
  writes = 0;
  const view = await mount();
  try {
    await click("新增範本", view.container);
    await type(dialog().querySelector("input")!, "Retry template");
    await click("儲存範本", dialog());
    assert.equal(dialog().querySelector('[role="alert"]')?.textContent, "儲存失敗");
    assert.equal(dialog().querySelector("input")!.value, "Retry template");
    assert.equal(view.prompt(), "My unsaved Prompt");
    failWrite = false;
    await act(async () => {
      const save = button("儲存範本", dialog());
      save.click();
      save.click();
    });
    assert.equal(writes, 2);
    assert.equal((stored.get("prompt-templates") as unknown[]).length, 1);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    failWrite = false;
    await view.close();
  }
});

test("saved templates reload and editing another template preserves the current Prompt", async () => {
  stored.set("prompt-templates", [
    { id: "first", name: "First", prompt: "First body" },
    { id: "second", name: "Second", prompt: "Second body" },
  ]);
  failWrite = false;
  const view = await mount("Restored draft");
  try {
    await choose("Second", view.container);
    assert.equal(view.prompt(), "Second body");
    await click("範本管理", view.container);
    await click("修改 · First", view.container);
    await type(dialog().querySelector("textarea")!, "Updated first body");
    await click("儲存變更", dialog());
    assert.equal(view.prompt(), "Second body");
    await type(view.container.querySelector("textarea")!, "Edited current draft");
    assert.ok(
      view.container.querySelector('[role="combobox"]')?.textContent?.includes("自訂 Prompt"),
    );
  } finally {
    await view.close();
  }
  const reopened = await mount("Restored draft");
  try {
    await choose("First", reopened.container);
    assert.equal(reopened.prompt(), "Updated first body");
  } finally {
    await reopened.close();
  }
});

test("template actions and help are complete in every supported locale", () => {
  const keys = Object.keys(promptTemplateCopy("en"));
  for (const locale of ["en", "zh-TW", "zh-CN", "ja", "ko"] as const) {
    const copy = promptTemplateCopy(locale);
    assert.deepEqual(Object.keys(copy), keys);
    assert.ok(Object.values(copy).every(value => value.trim().length));
  }
});

test("unchanged built-in Prompts follow the UI locale and migrate legacy defaults", async () => {
  stored.clear();
  const view = await mount(promptTemplates.summary + "\nWrite in zh-TW.");
  try {
    assert.equal(view.prompt(), builtinPrompt("summary", "zh-TW"));
    await view.setLocale("ja");
    assert.equal(view.prompt(), builtinPrompt("summary", "ja"));
    await view.setLocale("ko");
    assert.equal(view.prompt(), builtinPrompt("summary", "ko"));
    await type(view.container.querySelector("textarea")!, "My own instructions in English.");
    await view.setLocale("zh-CN");
    assert.equal(view.prompt(), "My own instructions in English.");
  } finally {
    await view.close();
  }
});

test("switching locale preserves the content and selection of saved user templates", async () => {
  const prompt = promptTemplates.summary + "\nWrite in en.";
  stored.clear();
  stored.set("prompt-templates", [{ id: "my-template", name: "My template", prompt }]);
  const view = await mount();
  try {
    await choose("My template", view.container);
    await view.setLocale("ja");
    assert.equal(view.prompt(), prompt);
    assert.match(view.container.querySelector('[role="combobox"]')!.textContent!, /My template/);
  } finally {
    await view.close();
  }
});
