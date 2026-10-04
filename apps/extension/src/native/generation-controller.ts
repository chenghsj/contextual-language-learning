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
  onCompleted: (
    jobId: string,
    title: string,
    documentId?: string,
    kind?: "standard" | "custom",
  ) => void = () => {},
  onAttention: (jobId: string, title: string, outcome: "interrupted" | "failed") => void = () => {},
  reconnectTimers = {
    set: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clear: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
): void {
  const clients = new Set<chrome.runtime.Port>();
  const pending = new Map<string, ForwardedRequest["type"]>();
  const authOwners = new Map<string, chrome.runtime.Port>();
  const healthChecks = new Map<
    string,
    { client: chrome.runtime.Port; timer: ReturnType<typeof setTimeout> }
  >();

  function checkHealth(
    request: Extract<HostRequest, { type: "health" }>,
    client: chrome.runtime.Port,
  ) {
    const finish = (message: HostMessage) => {
      if (healthChecks.get(request.id) !== check) return;
      clearTimeout(check.timer);
      healthChecks.delete(request.id);
      if (message.type === "health" && connection) {
        const version = runtime.getManifest?.().version;
        const compatible =
          message.protocolVersion === HOST_PROTOCOL_VERSION &&
          message.agentMode === "pi-sdk" &&
          (!version || message.version === version);
        if (reconnectTimer) reconnectTimers.clear(reconnectTimer);
        reconnectTimer = undefined;
        reconnectAttempt = 0;
        reconnectBlocked = !compatible;
        // Settings checks and the retry banner share this worker state. Publish
        // recovery before returning health, so success cannot leave a stale failure.
        connection = { status: compatible ? "ready" : "incompatible", attempt: 0 };
        broadcast(state());
      }
      if (clients.has(client)) client.postMessage(message);
    };
    const fail = (message: string) => finish({ id: request.id, type: "error", message });
    const check = {
      client,
      timer: setTimeout(() => fail("Native Host health check timed out."), 10_000),
    };
    healthChecks.set(request.id, check);
    try {
      // A persistent generation port can still answer after uninstall. A one-shot
      // connection makes the browser look up its current registration and launcher
      // without disconnecting any running Agent request.
      runtime.sendNativeMessage(HOST_NAME, request, (raw: unknown) => {
        const error = runtime.lastError?.message;
        if (error) return fail(error);
        const parsed = HostMessageSchema.safeParse(raw);
        if (
          !parsed.success ||
          parsed.data.id !== request.id ||
          (parsed.data.type !== "health" && parsed.data.type !== "error")
        ) {
          fail("Native Host returned an invalid health response. Update the Host and try again.");
          return;
        }
        // Return mismatched version/protocol metadata so Settings can explain it.
        finish(parsed.data);
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "Failed to start Native Host.");
    }
  }
  let ready = false;
  let handshakeId = "";
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let outbox: HostRequest[] = [];
  let host: chrome.runtime.Port | null = null;
  let active: GenerationControllerState["active"] = null;
  type Run = NonNullable<GenerationControllerState["active"]> & {
    delivered: boolean;
    documentId?: string;
    cancelling?: boolean;
  };
  const runs = new Map<string, Run>();
  function selectActive() {
    const values = [...runs.values()].filter(run => run.summary?.status !== "cancelled");
    active =
      values.find(run => run.summary?.status === "running") ??
      values.find(run => run.requestId === active?.requestId) ??
      values[0] ??
      null;
  }

  let connection: GenerationControllerState["connection"];
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectBlocked = false;
  let recoveryQueryId = "";
  function scheduleReconnect() {
    if (!clients.size || reconnectBlocked || reconnectTimer) return;
    if (reconnectAttempt >= 3) {
      connection = { status: "failed", attempt: 3 };
      broadcast(state());
      return;
    }
    const delay = [1000, 2000, 4000][reconnectAttempt++];
    connection = { status: "reconnecting", attempt: reconnectAttempt };
    broadcast(state());
    reconnectTimer = reconnectTimers.set(() => {
      reconnectTimer = undefined;
      if (!clients.size) return;
      try {
        const native = connectHost(true);
        native.postMessage({ id: handshakeId, type: "health" });
      } catch {
        scheduleReconnect();
      }
    }, delay);
  }
  function notifyAttention(
    outcome: "interrupted" | "failed",
    run: Run | undefined = active ? runs.get(active.requestId) : undefined,
  ): void {
    if (!run || run.delivered) return;
    run.delivered = true;
    try {
      onAttention(run.jobId, run.summary?.sourceTitle ?? "", outcome);
    } catch {}
  }
  function state(): GenerationControllerState {
    return {
      type: "generationState",
      active: active
        ? {
            requestId: active.requestId,
            jobId: active.jobId,
            kind: active.kind,
            summary: active.summary,
          }
        : null,
      queue: [...runs.values()]
        .filter(run => run.requestId !== active?.requestId && run.summary?.status !== "cancelled")
        .map(({ requestId, jobId, kind, summary }) => ({ requestId, jobId, kind, summary })),
      ...(connection ? { connection } : {}),
    };
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

  function connectHost(recovering = false): chrome.runtime.Port {
    if (host) return host;
    if (!recovering) {
      if (reconnectTimer) reconnectTimers.clear(reconnectTimer);
      reconnectTimer = undefined;
      reconnectBlocked = false;
    }
    const native = runtime.connectNative(HOST_NAME);
    host = native;
    ready = false;
    handshakeId = crypto.randomUUID();
    native.onMessage.addListener((raw: unknown) => {
      if (host !== native) return;
      const parsed = HostMessageSchema.safeParse(raw);
      if (!parsed.success) {
        reconnectBlocked = true;
        connection = { status: "incompatible", attempt: reconnectAttempt };
        const reason =
          "Native Host returned an invalid response. Update the Host and resume from task history.";
        for (const id of pending.keys()) broadcast({ id, type: "error", message: reason });
        for (const run of runs.values()) notifyAttention("interrupted", run);
        pending.clear();
        runs.clear();
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
          reconnectBlocked = true;
          connection = { status: "incompatible", attempt: reconnectAttempt };
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
          for (const run of runs.values()) notifyAttention("interrupted", run);
          pending.clear();
          authOwners.clear();
          outbox = [];
          runs.clear();
          active = null;
          broadcast(state());
          native.disconnect();
          return;
        }
        ready = true;
        if (recovering) {
          recoveryQueryId = crypto.randomUUID();
          pending.set(recoveryQueryId, "listJobs");
          native.postMessage({ id: recoveryQueryId, type: "listJobs" });
          if (recoveryQueryId)
            handshakeTimer = setTimeout(() => {
              if (host === native && recoveryQueryId) native.disconnect();
            }, 10_000);
        } else if (connection) {
          reconnectAttempt = 0;
          connection = { status: "ready", attempt: 0 };
          broadcast(state());
        }
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
      if (message.id === recoveryQueryId && message.type === "error") {
        recoveryQueryId = "";
        native.disconnect();
        return;
      }
      if (message.id === recoveryQueryId && message.type === "jobs") {
        clearTimeout(handshakeTimer);
        reconnectAttempt = 0;
        connection = { status: "ready", attempt: 0 };
        recoveryQueryId = "";
        broadcast(state());
      }
      const type = pending.get(message.id);

      const run =
        runs.get(message.id) ??
        (message.type === "job"
          ? [...runs.values()].find(run => run.jobId === message.job.id)
          : undefined);
      if (run && message.type === "job") {
        run.summary = message.job;
        selectActive();
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
      if (run) {
        if (message.type === "result") run.documentId = message.document.id;
        if (message.type === "documentChunk") run.documentId = message.documentId;
        if (message.type === "customChunk" && message.resource === "document")
          run.documentId = message.resourceId;
        if (message.type === "job" && message.job.status === "completed")
          run.documentId = message.job.documentId;
        if (message.type === "generationSettled" && !run.delivered) {
          if (run.summary?.status === "completed" && run.documentId) {
            run.delivered = true;
            try {
              onCompleted(
                run.jobId,
                run.summary.sourceTitle,
                run.documentId,
                run.kind ?? run.summary.kind,
              );
            } catch {}
          } else notifyAttention("interrupted", run);
        }
        if (
          message.type === "job" &&
          ["waiting", "cancelled", "failed"].includes(message.job.status)
        )
          notifyAttention(message.job.status === "failed" ? "failed" : "interrupted", run);
        if (message.type === "error")
          notifyAttention(
            run.cancelling ||
              run.summary?.status === "waiting" ||
              run.summary?.status === "cancelled"
              ? "interrupted"
              : "failed",
            run,
          );
        if (message.type === "cancelled") notifyAttention("interrupted", run);
      }
      if (terminal) {
        pending.delete(message.id);
        authOwners.delete(message.id);
        runs.delete(message.id);
        selectActive();
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
      for (const run of runs.values()) notifyAttention("interrupted", run);
      pending.clear();
      runs.clear();
      active = null;
      broadcast(state());
      scheduleReconnect();
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
      if (pending.has(request.id) || healthChecks.has(request.id)) {
        client.postMessage({
          id: request.id,
          type: "error",
          message: "Host request ID is already in use.",
        });
        return;
      }
      if (request.type === "health") {
        checkHealth(request, client);
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
      if (["generate", "resume", "generateCustom", "resumeCustom"].includes(request.type)) {
        const jobId =
          "payload" in request
            ? request.payload.id
            : "jobId" in request
              ? request.jobId
              : undefined;
        if ([...runs.values()].some(run => run.jobId === jobId)) {
          client.postMessage({
            id: request.id,
            type: "error",
            message: "This job is already queued or running.",
          });
          return;
        }
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
          const run: Run = {
            delivered: false,
            requestId: request.id,
            ...(request.type === "generateCustom" || request.type === "resumeCustom"
              ? { kind: "custom" as const }
              : {}),
            jobId:
              request.type === "generate" || request.type === "generateCustom"
                ? request.payload.id
                : request.jobId,
          };

          runs.set(request.id, run);
          selectActive();
          broadcast(state());
        }
        if (request.type === "cancel" || request.type === "cancelCustom") {
          const run = [...runs.values()].find(run => run.jobId === request.jobId);
          if (run) run.cancelling = true;
        }
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
        const failedRun = runs.get(request.id);
        if (failedRun) {
          notifyAttention("failed", failedRun);
          runs.delete(request.id);
          selectActive();
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
      for (const [id, check] of healthChecks) {
        if (check.client !== client) continue;
        clearTimeout(check.timer);
        healthChecks.delete(id);
      }
      if (!clients.size && reconnectTimer) {
        reconnectTimers.clear(reconnectTimer);
        reconnectTimer = undefined;
      }
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
