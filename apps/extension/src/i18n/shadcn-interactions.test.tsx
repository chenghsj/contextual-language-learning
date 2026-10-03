import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// Install DOM globals before importing Radix, which chooses its effect at load time.
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
const React = await import("react");
const { act, useState } = React;
const { createRoot } = await import("react-dom/client");
const { SearchableSelectField } = await import("../components/searchable-select-field");
const { NoticeViewport } = await import("../components/notice-viewport");
const { SubtitleImport } = await import("../components/subtitle-import");
const { SettingInfo } = await import("../components/setting-info");
const { SidePanelNavigation } = await import("../components/side-panel-navigation");
const { Disclosure } = await import("../components/disclosure");
const { Switch } = await import("../components/ui/switch");
const { HostConnectionSettings } = await import("../components/host-connection-settings");
const { hostConnectionCopy } = await import("./host-connection");
const { learningLanguageOptions } = await import("./preferences");
const { translate } = await import("./messages");

async function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
    (element as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}
async function key(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}
async function waitFor(predicate: () => boolean) {
  for (let attempts = 0; attempts < 100; attempts++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
  assert.ok(predicate(), "DOM update did not complete");
}
async function search(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("Host diagnostics show localized update guidance and distinguish package installs from project updates", async () => {
  const originalChrome = globalThis.chrome;
  const copied: string[] = [];
  const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  globalThis.chrome = {
    runtime: { id: extensionId, getManifest: () => ({ version: "0.1.0" }) },
  } as typeof chrome;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        copied.push(value);
      },
    },
  });
  const ui = hostConnectionCopy["zh-TW"];
  const view = await mount(
    <HostConnectionSettings
      locale="zh-TW"
      connected
      checked
      sdkMode
      version="0.1.0"
      protocolVersion={3}
      busy={false}
      error=""
      onCheck={() => {}}
    />,
  );
  try {
    assert.ok(view.container.textContent?.includes("Host 需要更新"));
    assert.ok(!view.container.textContent?.includes("尚未連線"));
    assert.ok(view.container.textContent?.includes(ui.protocolMismatch));
    assert.ok(view.container.textContent?.includes(ui.afterInstall));
    assert.equal(
      view.container.querySelector("code")?.textContent,
      "node scripts/install-host.mjs " + extensionId,
    );
    assert.ok(
      [...view.container.querySelectorAll("button")].some(button =>
        button.textContent?.includes(ui.releases),
      ),
    );
    const method = view.container.querySelector('[aria-label="安裝方式"]')!;
    await key(method, "Enter");
    const source = [...document.querySelectorAll('[role="option"]')].find(
      option => option.textContent === ui.sourceInstall,
    )!;
    assert.ok(source);
    await key(source, "Enter");
    assert.equal(
      view.container.querySelector("code")?.textContent,
      "pnpm build\npnpm host:install " + extensionId,
    );
    assert.ok(view.container.textContent?.includes(ui.sourceSteps));
    assert.ok(
      ![...view.container.querySelectorAll("button")].some(button =>
        button.textContent?.includes(ui.releases),
      ),
    );
    await key(view.container.querySelector('[aria-label="瀏覽器"]')!, "Enter");
    const edge = [...document.querySelectorAll('[role="option"]')].find(
      option => option.textContent === "Edge",
    )!;
    await key(edge, "Enter");
    const expected = "pnpm build\npnpm host:install " + extensionId + " --browser edge";
    assert.equal(view.container.querySelector("code")?.textContent, expected);
    await click(
      [...view.container.querySelectorAll("button")].find(
        button => button.textContent === ui.copyCommand,
      )!,
    );
    assert.deepEqual(copied, [expected]);
    await click(
      [...view.container.querySelectorAll("button")].find(
        button => button.textContent === ui.copyID,
      )!,
    );
    assert.deepEqual(copied, [expected, extensionId]);
  } finally {
    await view.close();
    globalThis.chrome = originalChrome;
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

test("Host checks show progress, prevent duplicate clicks and retain the completion time on success or failure", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", getManifest: () => ({ version: "0.1.0" }) },
  } as typeof chrome;
  const ui = hostConnectionCopy["zh-TW"];
  const completedAt = Date.parse("2026-10-01T07:01:10Z");
  let calls = 0;
  let complete: (connected: boolean) => void = () => {};
  function HostSettings() {
    const [busy, setBusy] = useState(false);
    const [connected, setConnected] = useState(true);
    const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
    return (
      <HostConnectionSettings
        locale="zh-TW"
        connected={connected}
        checked
        sdkMode
        version="0.1.0"
        protocolVersion={5}
        busy={busy}
        lastCheckedAt={lastCheckedAt}
        error={connected ? "" : ui.connectionFailed}
        onCheck={() => {
          calls++;
          setBusy(true);
          complete = result => {
            setConnected(result);
            setLastCheckedAt(completedAt);
            setBusy(false);
          };
        }}
      />
    );
  }
  const view = await mount(<HostSettings />);
  try {
    const button = [...view.container.querySelectorAll("button")].find(
      button => button.textContent === ui.check,
    )!;
    await click(button);
    assert.equal(calls, 1);
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.textContent, ui.checking);
    assert.ok(button.querySelector('svg[aria-hidden="true"]'));
    assert.equal(view.container.querySelector('[role="status"]')?.textContent, ui.checking);
    await click(button);
    assert.equal(calls, 1, "a pending check must not accept another click");
    await act(async () => complete(true));
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, ui.check);
    assert.equal(view.container.querySelector('[role="status"]')?.textContent, ui.connected);
    assert.ok(view.container.textContent?.includes(ui.lastChecked));
    assert.equal(
      view.container.querySelector("time")?.dateTime,
      new Date(completedAt).toISOString(),
    );
    await click(button);
    assert.equal(calls, 2);
    await act(async () => complete(false));
    assert.equal(button.disabled, false);
    assert.equal(view.container.querySelector('[role="status"]')?.textContent, ui.disconnected);
    assert.ok(view.container.textContent?.includes(ui.connectionFailed));
    assert.ok(view.container.querySelector("time"), "a failed check also records when it finished");
  } finally {
    await view.close();
    globalThis.chrome = originalChrome;
  }
});

for (const connected of [true, false]) {
  test(`Host uninstall guidance remains available when ${connected ? "connected" : "disconnected"} and copies the selected browser's package or project command`, async () => {
    const originalChrome = globalThis.chrome;
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const copied: string[] = [];
    const opened: string[] = [];
    let checks = 0;
    globalThis.chrome = {
      runtime: {
        id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        getManifest: () => ({ version: "0.1.0" }),
      },
      tabs: {
        create: async ({ url }: { url: string }) => {
          opened.push(url);
        },
      },
    } as unknown as typeof chrome;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    });
    const ui = hostConnectionCopy["zh-TW"];
    const view = await mount(
      <HostConnectionSettings
        locale="zh-TW"
        connected={connected}
        checked
        sdkMode
        version="0.1.0"
        protocolVersion={5}
        busy={false}
        error=""
        onCheck={() => {
          checks++;
        }}
      />,
    );
    try {
      const section = view.container.querySelector('[data-ui="hostUninstall"]')!;
      const trigger = section.querySelector("button")!;
      assert.ok(trigger.textContent?.includes(ui.uninstall));
      assert.equal(trigger.getAttribute("aria-expanded"), "false");
      assert.equal(section.querySelector("code"), null);
      await click(trigger);
      for (const copy of [
        ui.uninstallSteps,
        ui.uninstallEffects,
        ui.uninstallUnavailable,
        ui.uninstallPackageSteps,
      ]) {
        assert.ok(section.textContent?.includes(copy));
      }
      assert.equal(section.querySelector("code")?.textContent, "node scripts/uninstall-host.mjs");
      const copyButton = [...section.querySelectorAll("button")].find(
        button => button.textContent === ui.copyUninstallCommand,
      )!;
      await click(copyButton);
      assert.deepEqual(copied, ["node scripts/uninstall-host.mjs"]);
      assert.equal(section.querySelector('[role="status"]')?.textContent, ui.copied);
      await key(section.querySelector(`[aria-label="${ui.uninstallBrowser}"]`)!, "Enter");
      const edge = [...document.querySelectorAll('[role="option"]')].find(
        option => option.textContent === "Edge",
      )!;
      await key(edge, "Enter");
      assert.equal(
        section.querySelector("code")?.textContent,
        "node scripts/uninstall-host.mjs --browser edge",
      );
      assert.equal(
        section.querySelector('[role="status"]'),
        null,
        "changing commands clears stale copy feedback",
      );
      await click(copyButton);
      assert.equal(copied.at(-1), "node scripts/uninstall-host.mjs --browser edge");
      await click(
        [...section.querySelectorAll("button")].find(button => button.textContent === ui.releases)!,
      );
      assert.deepEqual(opened, [
        "https://github.com/chenghsj/immersive-language-learning/releases",
      ]);
      await key(section.querySelector(`[aria-label="${ui.commandLocation}"]`)!, "Enter");
      const project = [...document.querySelectorAll('[role="option"]')].find(
        option => option.textContent === ui.projectFolder,
      )!;
      await key(project, "Enter");
      assert.equal(
        section.querySelector("code")?.textContent,
        "pnpm host:uninstall --browser edge",
      );
      assert.ok(section.textContent?.includes(ui.uninstallSourceSteps));
      assert.equal(section.querySelector('[role="status"]'), null);
      await click(copyButton);
      assert.equal(copied.at(-1), "pnpm host:uninstall --browser edge");
      assert.equal(checks, 0, "copying instructions must not run a Host operation");
    } finally {
      await view.close();
      globalThis.chrome = originalChrome;
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });
}

test("language combobox searches aliases, selects by keyboard, dismisses and restores focus", async () => {
  const selected: string[] = [];
  function Picker() {
    const [value, setValue] = useState("ja");
    return (
      <SearchableSelectField
        ariaLabel="學習語言"
        value={value}
        options={learningLanguageOptions("zh-TW")}
        copy={{ search: "搜尋語言", empty: "找不到符合的語言" }}
        onValueChange={next => {
          selected.push(next);
          setValue(next);
        }}
      />
    );
  }
  const view = await mount(<Picker />);
  try {
    const trigger = view.container.querySelector('[role="combobox"]')!;
    assert.ok(trigger.textContent?.includes("日語"));
    await click(trigger);
    let input = document.querySelector('input[placeholder="搜尋語言"]') as HTMLInputElement;
    assert.equal(document.activeElement, input);
    assert.equal(document.querySelector('[aria-modal="true"]'), null);
    assert.equal(document.body.style.pointerEvents, "");
    await search(input, "spanish");
    assert.equal(document.querySelectorAll("[cmdk-item]:not([hidden])").length, 1);
    assert.match(document.querySelector("[cmdk-item]:not([hidden])")!.textContent!, /西班牙語/);
    await key(input, "ArrowDown");
    await key(input, "Enter");
    assert.deepEqual(selected, ["es"]);
    assert.match(trigger.textContent!, /西班牙語/);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    await click(trigger);
    input = document.querySelector('input[placeholder="搜尋語言"]') as HTMLInputElement;
    await search(input, "不存在的語言");
    assert.match(document.querySelector("[cmdk-empty]")!.textContent!, /找不到符合的語言/);
    await key(input, "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    assert.deepEqual(selected, ["es"], "dismissing must preserve the saved language");
    await click(trigger);
    assert.equal(
      (document.querySelector('input[placeholder="搜尋語言"]') as HTMLInputElement).value,
      "",
    );
    assert.equal(
      document.querySelectorAll("[cmdk-item]").length,
      learningLanguageOptions("zh-TW").length,
    );
  } finally {
    await view.close();
  }
});

test("disabled language combobox cannot open or change selection", async () => {
  const view = await mount(
    <SearchableSelectField
      ariaLabel="Language"
      value="ja"
      disabled
      options={learningLanguageOptions("en")}
      copy={{ search: "Search", empty: "Empty" }}
      onValueChange={() => assert.fail("disabled picker changed")}
    />,
  );
  try {
    await click(view.container.querySelector("button")!);
    assert.equal(document.querySelector("[cmdk-input]"), null);
  } finally {
    await view.close();
  }
});

test("setting help opens its level descriptions and Escape returns focus to its button", async () => {
  const view = await mount(
    <SettingInfo
      label="Level"
      infoLabel="About"
      explanation="Choose your level"
      items={[{ value: "B1", label: "Intermediate", description: "Everyday conversations" }]}
    />,
  );
  try {
    const trigger = view.container.querySelector("button")!;
    await click(trigger);
    const content = document.querySelector('[role="dialog"]')!;
    assert.match(content.textContent!, /Choose your level/);
    assert.match(content.textContent!, /B1 · Intermediate/);
    assert.match(content.textContent!, /Everyday conversations/);
    await key(content, "Escape");
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
  } finally {
    await view.close();
  }
});

test("page buttons navigate, Accordion toggles content and Switch preserves controlled state", async () => {
  function Controls() {
    const [page, setPage] = useState<"create" | "lessons" | "settings">("create");
    const [checked, setChecked] = useState(false);
    return (
      <>
        <SidePanelNavigation page={page} onNavigate={setPage} t={key => translate("zh-TW", key)} />
        <Disclosure title="Options">
          <p>Expanded content</p>
        </Disclosure>
        <Switch checked={checked} onCheckedChange={setChecked} aria-label="Backup" />
      </>
    );
  }
  const view = await mount(<Controls />);
  try {
    const pages = view.container.querySelectorAll<HTMLButtonElement>("nav button");
    assert.equal(pages.length, 2);
    assert.equal(pages[0].getAttribute("aria-current"), "page");
    await act(async () => {
      pages[1].focus();
    });
    assert.equal(document.activeElement, pages[1]);
    await click(pages[1]);
    assert.equal(pages[1].getAttribute("aria-current"), "page");
    assert.equal(pages[0].getAttribute("aria-current"), null);
    await click(pages[0]);
    assert.equal(pages[0].getAttribute("aria-current"), "page");
    const accordion = view.container.querySelector("button[aria-expanded]")!;
    assert.equal(accordion.getAttribute("aria-expanded"), "false");
    await click(accordion);
    assert.equal(accordion.getAttribute("aria-expanded"), "true");
    assert.match(view.container.textContent!, /Expanded content/);
    await click(accordion);
    assert.equal(accordion.getAttribute("aria-expanded"), "false");
    const toggle = view.container.querySelector('[role="switch"]')!;
    assert.equal(toggle.getAttribute("aria-checked"), "false");
    await click(toggle);
    assert.equal(toggle.getAttribute("aria-checked"), "true");
    await click(toggle);
    assert.equal(toggle.getAttribute("aria-checked"), "false");
  } finally {
    await view.close();
  }
});

test("notifications use Sonner defaults, replace existing feedback and dismiss application state", async () => {
  let dismissals = 0;
  function Notifications() {
    const [message, setMessage] = useState("找不到影片分頁");
    return (
      <>
        <button onClick={() => setMessage("請重新開啟影片")}>Update</button>
        <NoticeViewport
          error={message}
          notice=""
          dismiss={() => {
            dismissals++;
            setMessage("");
          }}
          closeLabel="關閉通知"
          regionLabel="通知"
          theme="dark"
        />
      </>
    );
  }
  const view = await mount(<Notifications />);
  try {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    assert.equal(
      document.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme"),
      "dark",
    );
    assert.equal(document.querySelectorAll("[data-sonner-toast]").length, 1);
    const toast = document.querySelector("[data-sonner-toast]")!;
    assert.match(toast.textContent!, /找不到影片分頁/);
    assert.notEqual(toast.getAttribute("data-rich-colors"), "true");
    assert.match(toast.className, /group-\[.toaster\]:bg-background/);
    await click(view.container.querySelector("button")!);
    await waitFor(
      () =>
        document.querySelector("[data-sonner-toast]")?.textContent?.includes("請重新開啟影片") ??
        false,
    );
    assert.equal(document.querySelectorAll("[data-sonner-toast]").length, 1);
    assert.match(document.querySelector("[data-sonner-toast]")!.textContent!, /請重新開啟影片/);
    await click(document.querySelector('[aria-label="關閉通知"]')!);
    assert.equal(dismissals, 1);
  } finally {
    await view.close();
  }
});

test("subtitle import uses a file button and applies pasted text only on explicit action", async () => {
  const applied: string[] = [];
  const files: File[] = [];
  function Importing() {
    const [draft, setDraft] = useState("");
    return (
      <SubtitleImport
        value={draft}
        onValueChange={setDraft}
        onPaste={text => applied.push(text)}
        onFile={file => {
          files.push(file);
        }}
        copy={{
          hint: "套用後會取代目前字幕",
          fileTab: "從檔案匯入",
          pasteTab: "貼上文字",
          fileHint: "選取後立即載入",
          fileButton: "匯入字幕檔",
          pasteLabel: "貼上字幕",
          pasteButton: "使用貼上的字幕",
          placeholder: "SRT、VTT 或純文字",
        }}
      />
    );
  }
  const view = await mount(<Importing />);
  try {
    const tabs = view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    assert.equal(
      view.container.querySelector("textarea"),
      null,
      "file method does not show the paste field",
    );
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    let pickerOpened = 0;
    input.click = () => {
      pickerOpened++;
    };
    const fileButton = Array.from(view.container.querySelectorAll("button")).find(
      button => button.textContent === "匯入字幕檔",
    )!;
    await click(fileButton);
    assert.equal(pickerOpened, 1);
    await click(tabs[1]);
    const pasteButton = Array.from(view.container.querySelectorAll("button")).find(
      button => button.textContent === "使用貼上的字幕",
    )!;
    assert.equal(pasteButton.disabled, true);
    const textarea = view.container.querySelector("textarea")!;
    assert.equal(textarea.value, "", "manual input starts empty");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        "Manual subtitle draft",
      );
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.deepEqual(applied, [], "editing a draft must not replace loaded subtitles");
    await click(pasteButton);
    assert.deepEqual(applied, ["Manual subtitle draft"]);
    await click(tabs[0]);
    assert.equal(view.container.querySelector("textarea"), null);
    await click(tabs[1]);
    assert.equal(
      view.container.querySelector("textarea")!.value,
      "Manual subtitle draft",
      "switching methods preserves the draft",
    );
    const file = new dom.window.File(["Synthetic caption"], "synthetic.vtt", { type: "text/vtt" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(files[0], file);
    assert.equal(input.value, "", "same file can be selected again");
  } finally {
    await view.close();
  }
});

test.after(() => {
  dom.window.close();
});

test("video recovery toast persists, contains reload, shows busy state and supports manual dismissal", async () => {
  let reloads = 0,
    dismissed = 0;
  function Recovery() {
    const [visible, setVisible] = useState(true);
    const [busy, setBusy] = useState(false);
    return (
      <NoticeViewport
        locale="zh-TW"
        error=""
        notice=""
        closeLabel="關閉通知"
        regionLabel="通知"
        theme="light"
        dismiss={() => {}}
        videoRecovery={{
          recovery: visible
            ? ({ id: 42, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } as chrome.tabs.Tab)
            : null,
          unavailable: {
            id: 42,
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          } as chrome.tabs.Tab,
          busy,
          failed: false,
          reload: async () => {
            reloads++;
            setBusy(true);
          },
          dismiss: () => {
            dismissed++;
            setVisible(false);
          },
        }}
      />
    );
  }
  const mounted = await mount(
    <>
      <Recovery />
      <button onClick={() => {}}>Unrelated</button>
    </>,
  );
  try {
    await waitFor(
      () =>
        document
          .querySelector("[data-sonner-toast]")
          ?.textContent?.includes("重新載入原影片分頁") ?? false,
    );
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5200));
    });
    assert.match(document.querySelector("[data-sonner-toast]")!.textContent!, /影片需要重新整理/);
    const reload = Array.from(document.querySelectorAll("button")).find(
      item => item.textContent === "重新載入原影片分頁",
    )!;
    await click(reload);
    assert.equal(reloads, 1);
    await waitFor(
      () =>
        !!Array.from(document.querySelectorAll("button")).find(
          item => item.textContent === "正在重新載入影片…" && item.disabled,
        ),
    );
    await click(document.querySelector("[data-close-button]")!);
    assert.equal(dismissed, 1);
  } finally {
    await mounted.close();
  }
});
