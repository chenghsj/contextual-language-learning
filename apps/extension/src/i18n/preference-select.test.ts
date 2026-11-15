import { readSource } from "../lib/source-contract";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile } from "node:fs/promises";
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
after(() => dom.window.close());
const React = await import("react");
const { createElement, act, useState, useEffect } = React;
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } =
  await import("../components/ui/select");
const { AppearancePreferences } = await import("../components/appearance-preferences");
const { PreferencesStore } = await import("../lib/preferences-store");
const { translate } = await import("./messages");

test("language and appearance choices retain stable values through persistence and reload", async () => {
  let saved: Record<string, unknown> = {};
  const storage = {
    get: async () => saved,
    set: async (next: Record<string, unknown>) => {
      saved = next;
    },
  };
  const store = new PreferencesStore(storage, "en");
  await store.load();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    const [preferences, setPreferences] = useState(store.current());
    useEffect(() => store.subscribe(setPreferences), []);
    const locale =
      preferences.uiLocalePreference === "auto" ? "en" : preferences.uiLocalePreference;
    return createElement(AppearancePreferences, {
      locale,
      browserLocale: "en",
      localePreference: preferences.uiLocalePreference,
      themePreference: preferences.themePreference,
      onLocale: value => {
        void store.save({ ...store.current(), uiLocalePreference: value });
      },
      onTheme: value => {
        void store.save({ ...store.current(), themePreference: value });
      },
    });
  }
  async function choose(id: string, label: string) {
    await act(async () => {
      const trigger = container.querySelector<HTMLElement>("#" + id)!;
      trigger.focus();
      trigger.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      element => element.textContent?.trim() === label,
    );
    assert.ok(option, "Missing option: " + label);
    await act(async () =>
      option.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    assert.equal(container.querySelectorAll('[role="combobox"]').length, 2);
    assert.equal(container.querySelector("select"), null);
    for (const id of ["ui-language-select", "appearance-select"])
      assert.ok(container.querySelector(`label[for="${id}"]`));
    const hint = container.querySelector("#ui-language-select")?.getAttribute("aria-describedby");
    assert.equal(hint, "ui-language-hint");
    assert.equal(
      container.querySelector("#" + hint)?.textContent,
      translate("en", "uiLanguageHint"),
    );
    await choose("ui-language-select", "繁體中文");
    await choose("appearance-select", translate("zh-TW", "themeDark"));
    const restored = await new PreferencesStore(storage).load();
    assert.equal(restored.uiLocalePreference, "zh-TW");
    assert.equal(restored.themePreference, "dark");
    await choose("ui-language-select", translate("zh-TW", "browserLanguage") + " · English");
    assert.equal((await new PreferencesStore(storage).load()).uiLocalePreference, "auto");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("shadcn Select renders an accessible, keyboard-controlled combobox", () => {
  const html = renderToStaticMarkup(
    createElement(
      Select,
      { value: "light" },
      createElement(
        SelectTrigger,
        { id: "appearance-select", "aria-label": "Appearance" },
        createElement(SelectValue),
      ),
      createElement(
        SelectContent,
        null,
        createElement(SelectItem, { value: "light" }, "Light"),
        createElement(SelectItem, { value: "dark" }, "Dark"),
      ),
    ),
  );
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Appearance"/);
  assert.match(html, /data-slot="select-trigger"/);
});

test("Radix popup and trigger follow the warm theme without an unstyled native dropdown", async () => {
  const select = await readSource(
    new URL("../../../../packages/ui/src/components/ui/select.tsx", import.meta.url),
  );
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(select, /SelectPrimitive\.Root/);
  assert.match(select, /SelectPrimitive\.Portal/);
  assert.match(select, /SelectPrimitive\.Content/);
  assert.match(select, /SelectPrimitive\.Item/);
  assert.match(select, /bg-popover text-popover-foreground/);
  assert.match(select, /focus:bg-accent focus:text-accent-foreground/);
  assert.match(css, /--primary: oklch\(0\.6171 0\.1375 39\.0427\)/);
  assert.match(select, /data-slot="select-trigger"/);
  assert.ok(
    (await readSource(new URL("../App.tsx", import.meta.url))).includes(
      "[&_[data-slot=select-trigger]]:w-full",
    ),
  );
});
