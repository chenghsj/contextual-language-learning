import React, { act } from "react";
import { createRoot } from "react-dom/client";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { PiSettings } from "../components/pi-settings";
import { toast } from "sonner";

class Port {
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
) {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test" });
  // React's input-event fallback uses these legacy hooks in this DOM harness.
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
  const ports: Port[] = [];
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    chrome: {
      runtime: {
        connect: () => {
          const port = new Port();
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
    item => item.textContent === label,
  );
  assert.ok(button, `Missing button: ${label}`);
  return button;
}
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
    assert.equal(button(container, "登入帳號").disabled, false);
    assert.doesNotMatch(container.textContent!, /Stale transport error/);
    const next = await start(container, ports);
    assert.notEqual(next.id, old.id);
  });
});
async function start(container: HTMLElement, ports: Port[]) {
  if (
    !Array.from(container.querySelectorAll("button")).some(item => item.textContent === "登入帳號")
  ) {
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find(item => item.textContent?.startsWith("Anthropic"))!
        .click(),
    );
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
    assert.doesNotMatch(container.textContent!, /Complete login|開啟登入網頁/);
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
    assert.match(container.textContent!, /已取消登入/);
  });
});
test("authentication instructions stay within the selected service card", async () => {
  await harness(async (container, ports) => {
    await start(container, ports);
    const auth = container.querySelector('[data-ui="piAuth"]')!;
    assert.ok(auth);
    assert.match(auth.parentElement!.textContent!, /^Anthropic/);
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
    await act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find(item => item.textContent?.startsWith("Antigravity"))!
        .click(),
    );
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
