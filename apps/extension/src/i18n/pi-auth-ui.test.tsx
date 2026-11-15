import React, { act } from "react";
import { createRoot } from "react-dom/client";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { piCopy } from "./pi";
import { toast } from "sonner";
import type { PiProviderInfo } from "@contextual/core";

class Port {
  constructor(private extraProviders: PiProviderInfo[] = []) {}
  messages: any[] = [];
  disconnected = false;
  listeners: ((message: unknown) => void)[] = [];
  disconnections: (() => void)[] = [];
  onMessage = {
    addListener: (listener: (message: unknown) => void) => this.listeners.push(listener),
  };
  onDisconnect = { addListener: (listener: () => void) => this.disconnections.push(listener) };
  postMessage(message: any) {
    this.messages.push(message);
    if (message.type === "piProviders")
      queueMicrotask(() =>
        this.emit({
          id: message.id,
          type: "piProviders",
          providers: [
            { id: "anthropic", label: "Anthropic", connected: false, methods: ["oauth"] },
            { id: "openai", label: "OpenAI", connected: true, methods: ["oauth", "api_key"] },
            { id: "antigravity", label: "Antigravity", connected: false, methods: ["oauth"] },
            { id: "openrouter", label: "OpenRouter", connected: false, methods: ["api_key"] },
            { id: "github-copilot", label: "GitHub Copilot", connected: false, methods: ["oauth"] },
            ...this.extraProviders,
          ],
        }),
      );
  }
  // Chrome does not emit onDisconnect to the caller of port.disconnect().
  disconnect() {
    this.disconnected = true;
  }
  emit(message: unknown) {
    for (const listener of this.listeners) listener(message);
  }
}

async function harness(
  run: (
    container: HTMLElement,
    ports: Port[],
    changeLocale: (locale: "zh-TW" | "ja") => Promise<void>,
    changeAvailability: (available: boolean) => Promise<void>,
  ) => Promise<void>,
  chooseAccount = true,
  extraProviders: PiProviderInfo[] = [],
) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://example.test",
    pretendToBeVisual: true,
  });
  // React's input-event fallback uses these legacy hooks in this DOM harness.
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const ports: Port[] = [];
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    ...Object.fromEntries(
      [
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
      ].map(key => [key, (dom.window as any)[key]]),
    ),
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
    navigator: {
      userAgent: dom.window.navigator.userAgent,
      clipboard: { writeText: async (_value: string) => {} },
    },
    chrome: {
      tabs: { create: async (_options: unknown) => ({}) },
      runtime: {
        connect: () => {
          const port = new Port(extraProviders);
          ports.push(port);
          return port;
        },
      },
    },
  };
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  // Radix determines DOM support at import time. Load it after this harness installs the DOM.
  const { PiSettings } = await import("../components/pi-settings");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PiSettings
          locale="zh-TW"
          available
          selectedProvider="openai"
          onSelect={() => {}}
          onChanged={() => {}}
        />,
      ),
    );
    if (chooseAccount)
      await act(async () => button(container, piCopy["zh-TW"].addConnection).click());
    await run(
      container,
      ports,
      async locale => {
        await act(async () =>
          root.render(
            <PiSettings
              locale={locale}
              available
              selectedProvider="openai"
              onSelect={() => {}}
              onChanged={() => {}}
            />,
          ),
        );
      },
      async available => {
        await act(async () =>
          root.render(
            <PiSettings
              locale="zh-TW"
              available={available}
              selectedProvider="openai"
              onSelect={() => {}}
              onChanged={() => {}}
            />,
          ),
        );
      },
    );
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
}
function button(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    item =>
      (item.textContent === label || item.getAttribute("aria-label") === label) &&
      item.getAttribute("role") !== "tab",
  );
  assert.ok(button, `Missing button: ${label}`);
  return button;
}
async function chooseTab(container: HTMLElement, method: "oauth" | "api_key") {
  const tab = container.querySelector<HTMLElement>(
    `[role="tab"][data-state][id$="trigger-${method}"]`,
  )!;
  assert.ok(tab);
  await act(async () =>
    tab.dispatchEvent(new window.MouseEvent("mousedown", { button: 0, bubbles: true })),
  );
  await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
  assert.equal(tab.getAttribute("data-state"), "active");
}
async function openPicker(container: HTMLElement) {
  const trigger = container.querySelector<HTMLButtonElement>("#pi-connection-service")!;
  assert.ok(trigger);
  if (trigger.getAttribute("aria-expanded") !== "true") await act(async () => trigger.click());
}
async function chooseService(container: HTMLElement, label: string) {
  await openPicker(container);
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item =>
    item.textContent?.startsWith(label),
  );
  assert.ok(item, `Missing service: ${label}`);
  await act(async () => item.click());
}
test("connected services are immediately visible and new connections stay collapsed", async () => {
  await harness(async container => {
    assert.match(
      container.querySelector('[data-ui="pi-connected-services"]')!.textContent!,
      /OpenAI/,
    );
    assert.equal(
      button(container, piCopy["zh-TW"].addConnection).getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(container.querySelector('[role="tablist"]'), null);
    assert.match(
      container.querySelector('[data-ui="pi-connected-services"] button[aria-expanded]')!
        .textContent!,
      /已設定 · 使用中/,
    );
    assert.equal(
      container.querySelectorAll('[data-ui="pi-connected-services"] button[aria-expanded]').length,
      1,
    );
  }, false);
});
test("inline tabs filter providers by SDK capability", async () => {
  await harness(async (container, ports) => {
    const ui = piCopy["zh-TW"];
    await chooseTab(container, "api_key");
    await openPicker(container);
    assert.deepEqual(
      [...document.querySelectorAll('[role="option"]')].map(
        item => item.textContent?.split(ui.configured)[0],
      ),
      ["OpenAI", "OpenRouter"],
    );
    await chooseService(container, "OpenRouter");
    await act(async () => button(container, ui.key).click());
    const request = ports.at(-1)!.messages.find(message => message.type === "piLogin");
    assert.equal(request.provider, "openrouter");
    assert.equal(request.method, "api_key");
    await chooseTab(container, "oauth");
    assert.equal(ports.at(-1)!.disconnected, true);
    await openPicker(container);
    assert.ok(document.body.textContent?.includes("Anthropic"));
    assert.ok(!container.querySelector('[role="tabpanel"]')!.textContent?.includes("OpenRouter"));
  });
});

test("service combobox uses Host-provided SDK names for each authentication method", async () => {
  await harness(
    async (container, ports) => {
      await openPicker(container);
      assert.equal(
        document.querySelector('[data-value="sdk-service"]')!.textContent,
        "OpenAI (ChatGPT subscription)",
      );
      await chooseService(container, "OpenAI (ChatGPT subscription)");
      assert.equal(
        container.querySelector("#pi-connection-service")!.textContent,
        "OpenAI (ChatGPT subscription)",
      );
      await chooseTab(container, "api_key");
      await openPicker(container);
      assert.equal(
        document.querySelector('[data-value="sdk-service"]')!.textContent,
        "OpenAI API key",
      );
      await chooseService(container, "OpenAI API key");
      await act(async () => button(container, piCopy["zh-TW"].key).click());
      assert.equal(
        ports.at(-1)!.messages.find(message => message.type === "piLogin").provider,
        "sdk-service",
      );
    },
    true,
    [
      {
        id: "sdk-service",
        label: "SDK Service",
        connected: false,
        methods: ["oauth", "api_key"],
        methodLabels: { oauth: "OpenAI (ChatGPT subscription)", api_key: "OpenAI API key" },
      },
    ],
  );
});

test("new connections hide legacy Codex while OpenAI supports both sign-in methods", async () => {
  await harness(
    async container => {
      const ui = piCopy["zh-TW"];
      await openPicker(container);
      assert.equal(document.querySelector('[role="option"][data-value="openai-codex"]'), null);
      await chooseService(container, "OpenAI");
      assert.ok(container.textContent?.includes(ui.openaiAccountHint));
      await chooseTab(container, "api_key");
      await chooseService(container, "OpenAI");
      const form = container.querySelector('[data-ui="pi-connection-form"]')!;
      assert.ok(form.textContent?.includes(ui.apiBilling));
      assert.ok(!form.textContent?.includes(ui.openaiAccountHint));
    },
    true,
    [{ id: "openai-codex", label: "OpenAI Codex (legacy)", connected: false, methods: ["oauth"] }],
  );
});

test("saved legacy Codex connections remain visible and can sign in again", async () => {
  await harness(
    async (container, ports) => {
      const ui = piCopy["zh-TW"];
      await openPicker(container);
      assert.equal(document.querySelector('[role="option"][data-value="openai-codex"]'), null);
      await act(async () =>
        container.querySelector<HTMLButtonElement>("#pi-connection-service")!.click(),
      );
      const connected = container.querySelector<HTMLElement>('[data-ui="pi-connected-services"]')!;
      const legacy = [
        ...connected.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
      ].find(item => item.textContent?.includes("OpenAI Codex (legacy)"))!;
      assert.ok(legacy);
      await act(async () => legacy.click());
      const item = document.getElementById(legacy.getAttribute("aria-controls")!)!;
      assert.ok(item.textContent?.includes(ui.openaiLegacyHint));
      await act(async () => button(item, ui.switchAccount).click());
      const request = ports.at(-1)!.messages.find(message => message.type === "piLogin");
      assert.equal(request.provider, "openai-codex");
      assert.equal(request.method, "oauth");
    },
    true,
    [{ id: "openai-codex", label: "OpenAI Codex (legacy)", connected: true, methods: ["oauth"] }],
  );
});

test("AWS credential setup can acknowledge existing credentials without entering a fake key", async () => {
  await harness(
    async (container, ports) => {
      const ui = piCopy["zh-TW"];
      await chooseTab(container, "api_key");
      await chooseService(container, "Amazon Bedrock");
      await act(async () => button(container, ui.key).click());
      const port = ports.at(-1)!;
      const request = port.messages.find(message => message.type === "piLogin");
      assert.equal(request.provider, "amazon-bedrock");
      const promptId = crypto.randomUUID();
      await act(async () =>
        port.emit({
          id: request.id,
          type: "piAuthPrompt",
          prompt: {
            promptId,
            kind: "text",
            message: "Configure AWS credentials, then press Enter to continue",
          },
        }),
      );
      assert.equal(button(container, ui.continue).disabled, false);
      await act(async () => button(container, ui.continue).click());
      assert.deepEqual(port.messages.at(-1), {
        id: request.id,
        type: "piAuthAnswer",
        loginId: request.id,
        promptId,
        value: "",
      });
      await act(async () => button(container, ui.cancel).click());
    },
    true,
    [{ id: "amazon-bedrock", label: "Amazon Bedrock", connected: false, methods: ["api_key"] }],
  );
});
for (const action of ["collapse", "tab"] as const) {
  test(`${action} preserves OAuth until explicit cancellation`, async () => {
    await harness(async (container, ports) => {
      const ui = piCopy["zh-TW"];
      const { port, id } = await start(container, ports);
      if (action === "collapse") await act(async () => button(container, ui.addConnection).click());
      else await chooseTab(container, "api_key");
      assert.equal(port.disconnected, false);
      assert.equal(
        port.messages.some(message => message.type === "piAuthCancel"),
        false,
      );
      assert.ok(container.querySelector('[data-ui="pi-auth-pending"]'));
      await act(async () => button(container, ui.resumeAuth).click());
      assert.match(container.querySelector('[data-ui="piAuth"]')!.textContent!, /請開啟登入網頁/);
      assert.equal(port.messages.filter(message => message.type === "piLogin").length, 1);
      await act(async () => button(container, ui.cancel).click());
      assert.equal(
        port.messages.filter(message => message.type === "piAuthCancel" && message.loginId === id)
          .length,
        1,
      );
    });
  });
}
test("collapsing API key input clears the sensitive draft and cancels its unfinished flow", async () => {
  await harness(async (container, ports) => {
    const ui = piCopy["zh-TW"];
    await chooseTab(container, "api_key");
    await chooseService(container, "OpenRouter");
    await act(async () => button(container, ui.key).click());
    const port = ports.at(-1)!;
    const request = port.messages.find(message => message.type === "piLogin");
    await act(async () =>
      port.emit({
        id: request.id,
        type: "piAuthPrompt",
        prompt: {
          promptId: crypto.randomUUID(),
          kind: "secret",
          message: "Enter OpenRouter API key",
        },
      }),
    );
    const input = container.querySelector('[data-ui="piAuth"] input') as HTMLInputElement;
    assert.equal(input.type, "password");
    await act(async () => button(container, ui.showKey).click());
    assert.equal(input.type, "text");
    await act(async () => button(container, ui.addConnection).click());
    assert.equal(port.disconnected, true);
    assert.equal(container.querySelector('[data-ui="piAuth"] input'), null);
    await act(async () => button(container, ui.addConnection).click());
    assert.equal(button(container, ui.key).disabled, false);
    assert.equal(container.querySelector('[data-ui="piAuth"] input'), null);
  });
});
test("losing Host availability cancels the transport and discards late login messages", async () => {
  await harness(async (container, ports, _changeLocale, changeAvailability) => {
    const old = await start(container, ports);
    await changeAvailability(false);
    assert.equal(old.port.disconnected, true);
    assert.doesNotMatch(container.textContent!, /Complete login|開啟登入網頁/);
    await act(async () =>
      old.port.emit({ id: old.id, type: "error", message: "Stale transport error" }),
    );
    await changeAvailability(true);
    assert.doesNotMatch(container.textContent!, /Stale transport error/);
    const next = await start(container, ports);
    assert.notEqual(next.id, old.id);
  });
});
async function start(container: HTMLElement, ports: Port[]) {
  if (
    !Array.from(container.querySelectorAll("button")).some(item => item.textContent === "登入帳號")
  ) {
    await chooseService(container, "Anthropic");
  }
  await act(async () => button(container, "登入帳號").click());
  const port = ports.at(-1)!;
  const request = port.messages.find(message => message.type === "piLogin");
  assert.ok(request);
  await act(async () =>
    port.emit({
      id: request.id,
      type: "piAuthEvent",
      event: {
        message: "Complete login in your browser.",
        url: "https://example.test/login",
      },
    }),
  );
  return { port, id: request.id };
}
test("cancel immediately re-enables login and removes stale auth UI without a Host reply", async () => {
  await harness(async (container, ports) => {
    const { port } = await start(container, ports);
    assert.equal(button(container, "登入帳號").disabled, true);
    await act(async () => button(container, "取消").click());
    assert.equal(button(container, "登入帳號").disabled, false);
    assert.equal(port.disconnected, true);
    assert.ok(port.messages.some(message => message.type === "piAuthCancel"));
    assert.doesNotMatch(container.textContent!, /Complete login|開啟登入網頁|已取消登入/);
    await start(container, ports);
    assert.equal(
      ports.filter(port => port.messages.some(message => message.type === "piLogin")).length,
      2,
    );
  });
});
test("Host error re-enables buttons even when local disconnect emits no event", async () => {
  await harness(async (container, ports) => {
    const { port, id } = await start(container, ports);
    await act(async () => port.emit({ id, type: "error", message: "This operation was aborted" }));
    assert.equal(button(container, "登入帳號").disabled, false);
    assert.doesNotMatch(container.textContent!, /Complete login|開啟登入網頁/);
  });
});
test("login failures and timeouts still show feedback", async () => {
  for (const message of ["Authentication failed: rejected credential", "Login timed out."]) {
    await harness(async (container, ports) => {
      const { port, id } = await start(container, ports);
      await act(async () => port.emit({ id, type: "error", message }));
      assert.equal(button(container, "登入帳號").disabled, false);
      assert.ok(container.querySelector('[data-ui="piFeedback"]'));
    });
  }
});
test("late callbacks from a cancelled login cannot reset the next login", async () => {
  await harness(async (container, ports) => {
    const old = await start(container, ports);
    await act(async () => button(container, "取消").click());
    const next = await start(container, ports);
    await act(async () => {
      old.port.emit({ id: old.id, type: "error", message: "Old error" });
      for (const disconnect of old.port.disconnections) disconnect();
    });
    assert.equal(button(container, "登入帳號").disabled, true);
    assert.doesNotMatch(container.textContent!, /Old error/);
    await act(async () => button(container, "取消").click());
    assert.equal(next.port.disconnected, true);
    assert.equal(button(container, "登入帳號").disabled, false);
  });
});
test("successful login toasts once without duplicating the service card status", async t => {
  const success = t.mock.method(toast, "success", () => "pi-auth-success");
  await harness(async (container, ports) => {
    const { port, id } = await start(container, ports);
    await act(async () => port.emit({ id, type: "piAuthDone" }));
    assert.equal(button(container, "登入帳號").disabled, false);
    assert.doesNotMatch(container.textContent!, /Complete login|開啟登入網頁/);
    assert.doesNotMatch(container.textContent!, /服務已連接/);
    assert.equal(success.mock.callCount(), 1);
    assert.deepEqual(success.mock.calls[0].arguments, [
      "服務已連接。",
      { id: "pi-auth-success", duration: 4000 },
    ]);
    await act(async () => port.emit({ id, type: "piAuthDone" }));
    assert.equal(success.mock.callCount(), 1);
    assert.equal(
      ports.filter(port => port.messages.some(message => message.type === "piProviders")).length,
      2,
    );
  });
});
test("cancel recovers even if the transport rejects the cancel request", async () => {
  await harness(async (container, ports) => {
    const { port } = await start(container, ports);
    port.postMessage = () => {
      throw new Error("Port is closed");
    };
    await act(async () => button(container, "取消").click());
    assert.equal(button(container, "登入帳號").disabled, false);
    assert.doesNotMatch(container.textContent!, /已取消登入/);
  });
});
test("authentication instructions stay within the selected service card", async () => {
  await harness(async (container, ports) => {
    await start(container, ports);
    const auth = container.querySelector('[data-ui="piAuth"]')!;
    assert.ok(auth);
    assert.equal(container.querySelector("#pi-connection-service")!.textContent, "Anthropic");
    assert.ok(container.querySelector('[data-ui="pi-connection-form"]')!.contains(auth));
    assert.match(auth.textContent!, /請開啟登入網頁並完成登入/);
    assert.ok(auth.contains(button(container, "取消")));
  });
});

test("SDK login event and redirect prompt follow the interface language", async () => {
  await harness(async (container, ports) => {
    const { port, id } = await start(container, ports);
    await act(async () => {
      port.emit({
        id,
        type: "piAuthEvent",
        event: {
          message:
            "Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.",
          url: "https://example.test/login",
        },
      });
      port.emit({
        id,
        type: "piAuthPrompt",
        prompt: {
          promptId: crypto.randomUUID(),
          kind: "manual_code",
          message: "Complete login in your browser, or paste the final redirect URL here:",
        },
      });
    });
    assert.match(container.textContent!, /若未自動完成/);
    assert.equal(container.querySelector("input"), null);
    const manual = button(container, "未自動完成？手動貼上網址或授權碼");
    assert.equal(manual.getAttribute("aria-expanded"), "false");
    await act(async () => manual.click());
    const input = container.querySelector("input")!;
    assert.ok(input);
    assert.equal(document.activeElement, input);
    assert.match(container.textContent!, /在此貼上最後的重新導向網址/);
    await act(async () => manual.click());
    assert.equal(container.querySelector("input"), null);
    assert.doesNotMatch(container.textContent!, /Complete sign-in|Complete login/);
  });
});

test("Antigravity uses Google login and the existing cancellable provider flow", async () => {
  await harness(async (container, ports) => {
    assert.equal(
      Array.from(container.querySelectorAll("button")).some(
        item => item.textContent === "使用 Google 登入",
      ),
      false,
    );
    await chooseService(container, "Antigravity");
    await act(async () => button(container, "使用 Google 登入").click());
    const port = ports.at(-1)!;
    const request = port.messages.find(message => message.type === "piLogin");
    assert.equal(request.provider, "antigravity");
    assert.equal(request.method, "oauth");
    await act(async () => button(container, "取消").click());
    assert.equal(button(container, "使用 Google 登入").disabled, false);
    assert.equal(port.disconnected, true);
  });
});

test("active SDK messages and late completion follow a changed UI locale", async t => {
  const success = t.mock.method(toast, "success", () => "pi-auth-success");
  await harness(async (container, ports, changeLocale) => {
    const { port, id } = await start(container, ports);
    await act(async () =>
      port.emit({
        id,
        type: "piAuthPrompt",
        prompt: {
          promptId: crypto.randomUUID(),
          kind: "secret",
          message: "Enter Anthropic API key",
        },
      }),
    );
    assert.match(container.textContent!, /請輸入 Anthropic/);
    await changeLocale("ja");
    assert.match(container.textContent!, /Anthropic の API キーを入力してください/);
    await act(async () => port.emit({ id, type: "piAuthDone" }));
    assert.equal(success.mock.calls[0].arguments[0], "サービスに接続しました。");
  });
});
test("unknown instructions and authentication errors retain original details beneath localized copy", async () => {
  await harness(async (container, ports) => {
    const { port, id } = await start(container, ports);
    await act(async () =>
      port.emit({
        id,
        type: "piAuthPrompt",
        prompt: {
          promptId: crypto.randomUUID(),
          kind: "text",
          message: "New provider instructions with special input requirements",
        },
      }),
    );
    assert.match(container.textContent!, /請依下方服務商指示繼續登入/);
    assert.equal(container.querySelector("details")?.open, true);
    assert.match(container.querySelector("details")!.textContent!, /special input requirements/);
    await act(async () => port.emit({ id, type: "error", message: "HTTP 401 unauthorized" }));
    assert.match(container.textContent!, /授權失敗/);
    assert.equal(container.querySelector("details")?.open, false);
    assert.match(container.querySelector("details")!.textContent!, /HTTP 401 unauthorized/);
  });
});

test("Copilot accepts an empty Enterprise domain, then offers the device code and sign-in URL", async t => {
  await harness(async (container, ports) => {
    const ui = piCopy["zh-TW"];
    const copied = t.mock.method(navigator.clipboard, "writeText", async () => {});
    const opened = t.mock.method(chrome.tabs, "create", async () => ({}) as chrome.tabs.Tab);
    await chooseService(container, "GitHub Copilot");
    await act(async () => button(container, ui.login).click());
    const port = ports.at(-1)!;
    const request = port.messages.find(message => message.type === "piLogin");
    const promptId = crypto.randomUUID();
    await act(async () =>
      port.emit({
        id: request.id,
        type: "piAuthPrompt",
        prompt: {
          promptId,
          kind: "text",
          message: "GitHub Enterprise URL/domain (blank for github.com)",
        },
      }),
    );
    const input = container.querySelector<HTMLInputElement>('[data-ui="piAuth"] input')!;
    assert.equal(input.placeholder, "github.com");
    assert.equal(input.value, "");
    assert.equal(button(container, ui.githubDefault).disabled, false);
    await act(async () => button(container, ui.githubDefault).click());
    assert.deepEqual(
      port.messages.find(message => message.type === "piAuthAnswer"),
      { id: request.id, type: "piAuthAnswer", loginId: request.id, promptId, value: "" },
    );
    await act(async () =>
      port.emit({
        id: request.id,
        type: "piAuthEvent",
        event: { message: "Sign-in code: ABCD-1234", url: "https://github.com/login/device" },
      }),
    );
    assert.equal(container.querySelector('[data-ui="piAuth"] code')?.textContent, "ABCD-1234");
    assert.equal(container.querySelector('[data-ui="piAuth"] input'), null);
    await act(async () => button(container, ui.copyCode).click());
    assert.deepEqual(copied.mock.calls[0].arguments, ["ABCD-1234"]);
    await act(async () => button(container, ui.open).click());
    assert.deepEqual(opened.mock.calls[0].arguments, [{ url: "https://github.com/login/device" }]);
    await act(async () => button(container, ui.cancel).click());
    assert.equal(container.querySelector('[data-ui="piAuth"] code'), null);
  });
});

test("an empty non-Copilot text field or secret remains required", async () => {
  for (const kind of ["text", "secret"] as const) {
    await harness(async (container, ports) => {
      const { port, id } = await start(container, ports);
      await act(async () =>
        port.emit({
          id,
          type: "piAuthPrompt",
          prompt: {
            promptId: crypto.randomUUID(),
            kind,
            message: "GitHub Enterprise URL/domain (blank for github.com)",
          },
        }),
      );
      assert.equal(button(container, piCopy["zh-TW"].continue).disabled, true);
    });
  }
});
