import {
  HostRequestSchema, type HostMessage, type HostRequest, type JobSummary,
} from "@immersive/core";

export const GENERATION_CONTROLLER_PORT = "immersive:background-generation";
const HOST_NAME = "dev.immersive.language_learning";

type ForwardedRequest = Extract<HostRequest, {
  type: "checkDuplicates" | "generate" | "resume" | "cancel" | "resumeBackups";
}>;

export type GenerationControllerState = {
  type: "generationState";
  active: {
    requestId: string; jobId: string; summary?: JobSummary;
  } | null;
};

export type GenerationControllerMessage = HostMessage | GenerationControllerState;

/**
 * Keep the Agent/Native Host connected from the extension service worker,
 * independently of the Side Panel document. Closing the panel disconnects
 * only its UI port; the running host port remains alive.
 */
export function installGenerationController(
  runtime: typeof chrome.runtime = chrome.runtime,
): void {
  const clients = new Set<chrome.runtime.Port>();
  const pending = new Map<string, ForwardedRequest["type"]>();
  let host: chrome.runtime.Port | null = null;
  let active: GenerationControllerState["active"] = null;

  function state(): GenerationControllerState {
    return { type: "generationState", active: active ? { ...active } : null };
  }

  function broadcast(message: GenerationControllerMessage): void {
    for (const client of clients) {
      try { client.postMessage(message); }
      catch { clients.delete(client); }
    }
  }

  function disconnectIdleHost(): void {
    if (active || pending.size || clients.size || !host) return;
    const idle = host;
    host = null;
    idle.disconnect();
  }

  function connectHost(): chrome.runtime.Port {
    if (host) return host;
    const native = runtime.connectNative(HOST_NAME);
    host = native;
    native.onMessage.addListener((message: HostMessage) => {
      if (host !== native) return;
      const type = pending.get(message.id);

      if (active && message.id === active.requestId && message.type === "job") {
        active = { ...active, summary: message.job };
      }
      // Delivery is not the end of a generation request: optional Drive backup
      // continues after the lesson has been returned to the Side Panel.
      const terminal = message.type === "error" || message.type === "generationSettled" ||
        message.type === "backupsFinished" || message.type === "duplicates" ||
        message.type === "cancelled";
      if (terminal) {
        pending.delete(message.id);
        if (active && message.id === active.requestId &&
          (type === "generate" || type === "resume")) {
          active = null;
        }
      }
      broadcast(message);
      if (message.type === "job" || terminal) broadcast(state());
      disconnectIdleHost();
    });
    native.onDisconnect.addListener(() => {
      if (host !== native) return;
      host = null;
      const reason = runtime.lastError?.message ??
        "The background Agent connection ended. Saved checkpoints can be resumed from task history.";
      for (const id of pending.keys()) {
        broadcast({ id, type: "error", message: reason });
      }
      if (active && !pending.has(active.requestId)) {
        broadcast({ id: active.requestId, type: "error", message: reason });
      }
      pending.clear();
      active = null;
      broadcast(state());
    });
    return native;
  }

  runtime.onConnect.addListener(client => {
    if (client.name !== GENERATION_CONTROLLER_PORT) return;
    // Restrict Native Host generation commands to the extension's Side Panel.
    // An isolated content script can also call runtime.connect(), so checking
    // only sender.id is not sufficient.
    let fromPanel = false;
    try {
      const senderUrl = new URL(client.sender?.url ?? "");
      fromPanel = senderUrl.protocol === "chrome-extension:" &&
        senderUrl.hostname === runtime.id && senderUrl.pathname === "/sidepanel.html" &&
        !client.sender?.tab;
    } catch { /* Unknown or missing sender document. */ }
    if (!fromPanel || (client.sender?.id && client.sender.id !== runtime.id)) {
      client.disconnect();
      return;
    }
    clients.add(client);

    client.onMessage.addListener((raw: unknown) => {
      if (raw && typeof raw === "object" &&
        (raw as { type?: unknown }).type === "watch") {
        client.postMessage(state());
        return;
      }
      const checked = HostRequestSchema.safeParse(raw);
      const id = raw && typeof raw === "object" && "id" in raw &&
        typeof raw.id === "string" ? raw.id : "invalid-request";
      if (!checked.success || !["checkDuplicates", "generate", "resume", "cancel", "resumeBackups"].includes(checked.data.type)) {
        client.postMessage({ id, type: "error", message: "Unsupported background generation request." });
        return;
      }
      const request = checked.data as ForwardedRequest;
      if ((request.type === "generate" || request.type === "resume") && active) {
        client.postMessage({ id: request.id, type: "error",
          message: "An Agent job is already running. Check the task history before starting another." });
        return;
      }
      if (request.type === "generate" && request.id !== request.payload.id) {
        client.postMessage({ id: request.id, type: "error", message: "Generation request IDs do not match." });
        return;
      }

      try {
        const native = connectHost();
        if (request.type === "generate" || request.type === "resume") {
          active = {
            requestId: request.id,
            jobId: request.type === "generate" ? request.payload.id : request.jobId,
          };
          broadcast(state());
        }
        pending.set(request.id, request.type);
        native.postMessage(request);
      } catch (error) {
        pending.delete(request.id);
        if (active?.requestId === request.id) {
          active = null;
          broadcast(state());
        }
        client.postMessage({ id: request.id, type: "error",
          message: error instanceof Error ? error.message : "Failed to start the background Agent." });
        disconnectIdleHost();
      }
    });

    client.onDisconnect.addListener(() => {
      clients.delete(client);
      // The Native Host remains connected while any Agent request is active.
      disconnectIdleHost();
    });
  });
}
