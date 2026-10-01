import { useEffect, useReducer, useRef } from "react";
import { HostMessageSchema } from "@immersive/core";
import type { UiLocale } from "../i18n/messages";
import { piCopy } from "../i18n/pi";
import { initialPiAuthState, piAuthReducer } from "../lib/pi-auth-state";
import { HOST_NAME, nativeOnce } from "../native/host-client";

type Options = { available: boolean; locale: UiLocale;
  onConnected: (provider: string) => void | Promise<void>; onLoggedOut: () => void | Promise<void> };
export function usePiAuth(options: Options) {
  const [state, dispatch] = useReducer(piAuthReducer, initialPiAuthState);
  const latest = useRef(options); latest.current = options;
  const operation = useRef<string | null>(null);
  const connection = useRef<{ id: string; port: chrome.runtime.Port } | null>(null);
  const mounted = useRef(true);
  const ui = () => piCopy[latest.current.locale];

  function closeConnection(): void {
    const current = connection.current;
    connection.current = null;
    current?.port.disconnect();
  }
  function finish(id: string, status: string): void {
    if (operation.current !== id || !mounted.current) return;
    operation.current = null;
    dispatch({ type: "finish", id, status });
    closeConnection(); // Local disconnect does not fire onDisconnect on this end.
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current = null; closeConnection(); };
  }, []);
  useEffect(() => {
    if (options.available) return;
    operation.current = null;
    closeConnection();
    dispatch({ type: "reset" });
  }, [options.available]);

  function login(provider: string, method: "api_key" | "oauth"): void {
    if (operation.current || !latest.current.available) return;
    const id = crypto.randomUUID();
    operation.current = id;
    dispatch({ type: "start", kind: "login", id, provider });
    let port: chrome.runtime.Port;
    try { port = chrome.runtime.connectNative(HOST_NAME); }
    catch (error) { finish(id, String(error)); return; }
    connection.current = { id, port };
    port.onMessage.addListener(raw => {
      if (connection.current?.port !== port || operation.current !== id) return;
      const parsed = HostMessageSchema.safeParse(raw);
      if (!parsed.success) { finish(id, ui().invalid); return; }
      const message = parsed.data;
      if (message.id !== id) return;
      switch (message.type) {
        case "piAuthPrompt": dispatch({ type: "prompt", id, prompt: message.prompt }); break;
        case "piAuthPromptClosed": dispatch({ type: "promptClosed", id, promptId: message.promptId }); break;
        case "piAuthEvent": dispatch({ type: "event", id, event: message.event }); break;
        case "error": finish(id, message.message); break;
        case "piAuthDone":
          finish(id, "");
          void Promise.resolve().then(() => {
            if (mounted.current) return latest.current.onConnected(provider);
          }).catch(error => {
            if (mounted.current) dispatch({ type: "finish", id, status: String(error) });
          });
          break;
      }
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      finish(id, error ?? ui().ended);
    });
    try { port.postMessage({ id, type: "piLogin", provider, method }); }
    catch (error) { finish(id, String(error)); }
  }
  function cancel(): void {
    const current = connection.current;
    if (!current) return;
    try { current.port.postMessage({ id: crypto.randomUUID(), type: "piAuthCancel", loginId: current.id }); }
    catch { /* A closed transport must still release the local UI. */ }
    finally { finish(current.id, ui().cancelled); }
  }
  function answer(): void {
    const current = connection.current;
    if (!current || state.kind !== "login" || !state.prompt) return;
    try {
      current.port.postMessage({ id: current.id, type: "piAuthAnswer", loginId: current.id,
        promptId: state.prompt.promptId, value: state.value });
      dispatch({ type: "promptClosed", id: current.id, promptId: state.prompt.promptId });
    } catch (error) { finish(current.id, String(error)); }
  }
  async function logout(provider: string): Promise<void> {
    if (operation.current || !latest.current.available) return;
    const id = crypto.randomUUID();
    operation.current = id;
    dispatch({ type: "start", kind: "logout", id, provider });
    try {
      await nativeOnce({ id, type: "piLogout", provider });
      if (operation.current !== id || !mounted.current) return;
      await latest.current.onLoggedOut();
      finish(id, "");
    } catch (error) { finish(id, String(error)); }
  }
  return { state, login, cancel, answer, logout,
    setValue: (value: string) => {
      if (state.kind === "login") dispatch({ type: "value", id: state.id, value });
    } };
}
