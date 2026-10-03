import {
  HOST_PROTOCOL_VERSION,
  HostRequestSchema,
  HostMessageSchema,
  type HostMessage,
  type HostRequest,
  type BackgroundGenerationState,
} from "@immersive/core";

export const GENERATION_CONTROLLER_PORT = "immersive:background-generation";
const HOST_NAME = "dev.immersive.language_learning";

type ForwardedRequest = HostRequest;

export type GenerationControllerState = BackgroundGenerationState;

export type GenerationControllerMessage = HostMessage | GenerationControllerState;

/**
 * Keep the Agent/Native Host connected from the extension service worker,
 * independently of the Side Panel document. Closing the panel disconnects
 * only its UI port; the running host port remains alive.
 */
export function installGenerationController(
  runtime: typeof chrome.runtime = chrome.runtime,
  onCompleted: (jobId: string, title: string, documentId?: string) => void = () => {},
  onAttention: (jobId: string, title: string, outcome: "interrupted" | "failed") => void = () => {},
): void {
  const clients = new Set<chrome.runtime.Port>();
  const pending = new Map<string, ForwardedRequest["type"]>();
  const authOwners = new Map<string, chrome.runtime.Port>();
  let ready = false;
  let handshakeId = "";
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let outbox: HostRequest[] = [];
  let host: chrome.runtime.Port | null = null;
  let active: GenerationControllerState["active"] = null;

  let cancellationRequested = false;
  let delivered = false;
  let deliveredDocumentId: string | undefined;
  function notifyAttention(outcome: "interrupted" | "failed"): void {
    if (!active || delivered) return;
    delivered = true;
    try {
      onAttention(active.jobId, active.summary?.sourceTitle ?? "", outcome);
    } catch {
      /* Notification failures must not affect the job. */
    }
  }

  function state(): GenerationControllerState {
    return { type: "generationState", active: active ? { ...active } : null };
  }

  function broadcast(message: GenerationControllerMessage): void {
    for (const client of clients) {
      try {
        client.postMessage(message);
      } catch {
        clients.delete(client);
      }
    }
  }

  function disconnectIdleHost(): void {
    if (active || pending.size || clients.size || !host) return;
    const idle = host;
    host = null;
    ready = false;
    clearTimeout(handshakeTimer);
    idle.disconnect();
  }

  function connectHost(): chrome.runtime.Port {
    if (host) return host;
    const native = runtime.connectNative(HOST_NAME);
    host = native;
    ready = false;
    handshakeId = crypto.randomUUID();
    native.onMessage.addListener((raw: unknown) => {
      if (host !== native) return;
      const parsed = HostMessageSchema.safeParse(raw);
      if (!parsed.success) {
        const reason =
          "Native Host returned an invalid response. Update the Host and resume from task history.";
        for (const id of pending.keys()) broadcast({ id, type: "error", message: reason });
        notifyAttention("interrupted");
        pending.clear();
        active = null;
        broadcast(state());
        native.disconnect();
        return;
      }
      const message = parsed.data;
      if (message.id === handshakeId) {
        clearTimeout(handshakeTimer);
        const version = runtime.getManifest?.().version;
        if (
          message.type !== "health" ||
          message.protocolVersion !== HOST_PROTOCOL_VERSION ||
          message.agentMode !== "pi-sdk" ||
          (version && message.version !== version)
        ) {
          // Health is diagnostic: retain the installed Host's metadata even when
          // business requests are blocked, so the panel can explain the mismatch.
          for (const [id, type] of pending) {
            if (type === "health" && message.type === "health") broadcast({ ...message, id });
            else
              broadcast({
                id,
                type: "error",
                message:
                  "Native Host is incompatible. Reinstall the current Host and reload the extension.",
              });
          }
          notifyAttention("interrupted");
          pending.clear();
          authOwners.clear();
          outbox = [];
          active = null;
          broadcast(state());
          native.disconnect();
          return;
        }
        ready = true;
        const queued = outbox;
        outbox = [];
        for (const request of queued) {
          if (request.type === "health") {
            pending.delete(request.id);
            broadcast({ ...message, id: request.id });
          } else native.postMessage(request);
        }
        disconnectIdleHost();
        return;
      }
      const type = pending.get(message.id);

      if (active && message.id === active.requestId && message.type === "job") {
        active = { ...active, summary: message.job };
      }
      // Delivery is not the end of a generation request: optional Drive backup
      // continues after the lesson has been returned to the Side Panel.
      const terminal =
        message.type === "error" ||
        (type !== undefined &&
          (type === "generate" ||
          type === "resume" ||
          type === "generateCustom" ||
          type === "resumeCustom"
            ? message.type === "generationSettled" || message.type === "cancelled"
            : type === "resumeBackups"
              ? message.type === "backupsFinished"
              : type === "piLogin"
                ? message.type === "piAuthDone"
                : type === "getDocument" || type === "getCustomDocument" || type === "getCustomJob"
                  ? message.type === "result" ||
                    ((message.type === "documentChunk" || message.type === "customChunk") &&
                      message.index === message.total - 1)
                  : true));
      if ((type === "cancel" || type === "cancelCustom") && cancellationRequested) {
        if (message.type === "cancelled") notifyAttention("interrupted");
        if (message.type === "error") cancellationRequested = false;
      }
      if (
        active?.requestId === message.id &&
        (type === "generate" ||
          type === "resume" ||
          type === "generateCustom" ||
          type === "resumeCustom")
      ) {
        if (message.type === "result") deliveredDocumentId = message.document.id;
        if (message.type === "documentChunk") deliveredDocumentId = message.documentId;
        if (message.type === "customChunk" && message.resource === "document")
          deliveredDocumentId = message.resourceId;
        if (message.type === "job" && message.job.status === "completed")
          deliveredDocumentId = message.job.documentId;
        // Completion follows a saved lesson, never AI output alone or failed backup.
        if (message.type === "generationSettled" && !delivered) {
          if (active.summary?.status === "completed" && deliveredDocumentId) {
            delivered = true;
            try {
              onCompleted(active.jobId, active.summary.sourceTitle, deliveredDocumentId);
            } catch {
              /* Notification failures must not interrupt task completion. */
            }
          } else notifyAttention("interrupted");
        }
        if (
          message.type === "job" &&
          ["waiting", "cancelled", "failed"].includes(message.job.status)
        )
          notifyAttention(message.job.status === "failed" ? "failed" : "interrupted");
        if (message.type === "error")
          notifyAttention(
            cancellationRequested ||
              active.summary?.status === "waiting" ||
              active.summary?.status === "cancelled"
              ? "interrupted"
              : "failed",
          );
        if (message.type === "cancelled") notifyAttention("interrupted");
      }
      if (terminal) {
        pending.delete(message.id);
        authOwners.delete(message.id);
        if (
          active &&
          message.id === active.requestId &&
          (type === "generate" ||
            type === "resume" ||
            type === "generateCustom" ||
            type === "resumeCustom")
        ) {
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
      ready = false;
      clearTimeout(handshakeTimer);
      outbox = [];
      authOwners.clear();
      const reason =
        runtime.lastError?.message ??
        "The background Agent connection ended. Saved checkpoints can be resumed from task history.";
      for (const id of pending.keys()) {
        broadcast({ id, type: "error", message: reason });
      }
      if (active && !pending.has(active.requestId)) {
        broadcast({ id: active.requestId, type: "error", message: reason });
      }
      notifyAttention("interrupted");
      pending.clear();
      active = null;
      broadcast(state());
    });
    handshakeTimer = setTimeout(() => {
      if (host === native && !ready) native.disconnect();
    }, 10_000);
    // Start the handshake only after callers have reserved their pending request.
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
      fromPanel =
        senderUrl.protocol === "chrome-extension:" &&
        senderUrl.hostname === runtime.id &&
        senderUrl.pathname === "/sidepanel.html" &&
        !client.sender?.tab;
    } catch {
      /* Unknown or missing sender document. */
    }
    if (!fromPanel || (client.sender?.id && client.sender.id !== runtime.id)) {
      client.disconnect();
      return;
    }
    clients.add(client);

    client.onMessage.addListener((raw: unknown) => {
      if (raw && typeof raw === "object" && (raw as { type?: unknown }).type === "watch") {
        client.postMessage(state());
        return;
      }
      const checked = HostRequestSchema.safeParse(raw);
      const id =
        raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string"
          ? raw.id
          : "invalid-request";
      if (!checked.success) {
        client.postMessage({ id, type: "error", message: "Invalid Host request." });
        return;
      }
      const request = checked.data;
      if (pending.has(request.id)) {
        client.postMessage({
          id: request.id,
          type: "error",
          message: "Host request ID is already in use.",
        });
        return;
      }
      if (
        (request.type === "piAuthAnswer" || request.type === "piAuthCancel") &&
        authOwners.get(request.loginId) !== client
      ) {
        client.postMessage({
          id: request.id,
          type: "error",
          message: "This login belongs to another panel.",
        });
        return;
      }
      if (
        (request.type === "generate" ||
          request.type === "resume" ||
          request.type === "generateCustom" ||
          request.type === "resumeCustom") &&
        active
      ) {
        client.postMessage({
          id: request.id,
          type: "error",
          message:
            "An Agent job is already running. Check the task history before starting another.",
        });
        return;
      }
      if (
        (request.type === "generate" || request.type === "generateCustom") &&
        request.id !== request.payload.id
      ) {
        client.postMessage({
          id: request.id,
          type: "error",
          message: "Generation request IDs do not match.",
        });
        return;
      }

      try {
        const native = connectHost();
        if (
          request.type === "generate" ||
          request.type === "resume" ||
          request.type === "generateCustom" ||
          request.type === "resumeCustom"
        ) {
          cancellationRequested = false;
          delivered = false;
          deliveredDocumentId = undefined;
          active = {
            requestId: request.id,
            jobId:
              request.type === "generate" || request.type === "generateCustom"
                ? request.payload.id
                : request.jobId,
          };
          broadcast(state());
        }
        if (
          (request.type === "cancel" || request.type === "cancelCustom") &&
          active?.jobId === request.jobId
        )
          cancellationRequested = true;
        if (request.type !== "piAuthAnswer" && request.type !== "piAuthCancel") {
          pending.set(request.id, request.type);
        }
        if (request.type === "piLogin") authOwners.set(request.id, client);
        if (ready) native.postMessage(request);
        else {
          const startHandshake = outbox.length === 0;
          outbox.push(request);
          if (startHandshake) native.postMessage({ id: handshakeId, type: "health" });
        }
      } catch (error) {
        pending.delete(request.id);
        if (active?.requestId === request.id) {
          notifyAttention("failed");
          active = null;
          broadcast(state());
        }
        client.postMessage({
          id: request.id,
          type: "error",
          message: error instanceof Error ? error.message : "Failed to start the background Agent.",
        });
        disconnectIdleHost();
      }
    });

    client.onDisconnect.addListener(() => {
      clients.delete(client);
      for (const [id, owner] of authOwners) {
        if (owner !== client) continue;
        authOwners.delete(id);
        outbox = outbox.filter(request => request.id !== id);
        pending.delete(id);
        if (ready)
          host?.postMessage({ id: crypto.randomUUID(), type: "piAuthCancel", loginId: id });
      }
      // The Native Host remains connected while any Agent request is active.
      disconnectIdleHost();
    });
  });
}
