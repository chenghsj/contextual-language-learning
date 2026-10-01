import { HostMessageSchema, HostRequestSchema, type HostMessage } from "@immersive/core";

export const HOST_NAME = "dev.immersive.language_learning";

/** One-shot Native Messaging request. Every reply is checked before it reaches UI state. */
export function nativeOnce(request: { id: string; type: string; [key: string]: unknown },
  runtime: typeof chrome.runtime = chrome.runtime): Promise<HostMessage> {
  return new Promise((resolve, reject) => {
    const checkedRequest = HostRequestSchema.safeParse(request);
    if (!checkedRequest.success) { reject(new Error("Invalid Native Host request.")); return; }
    const port = runtime.connectNative(HOST_NAME);
    let finished = false;
    port.onMessage.addListener((raw: unknown) => {
      const parsed = HostMessageSchema.safeParse(raw);
      if (!parsed.success) {
        finished = true;
        port.disconnect();
        reject(new Error("Native Host returned an invalid response. Update the Host and try again."));
        return;
      }
      const response = parsed.data;
      if (response.id !== request.id) return;
      finished = true;
      port.disconnect();
      if (response.type === "error") reject(new Error(response.message));
      else resolve(response as HostMessage);
    });
    port.onDisconnect.addListener(() => {
      if (!finished) reject(new Error(runtime.lastError?.message ?? "Native Host disconnected."));
    });
    try { port.postMessage(checkedRequest.data); }
    catch (error) { finished = true; port.disconnect(); reject(error); }
  });
}
