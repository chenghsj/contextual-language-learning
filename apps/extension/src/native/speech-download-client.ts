import {
  SpeechDownloadIdSchema,
  SpeechDownloadSnapshotSchema,
  SpeechDownloadViewMessageSchema,
  SPEECH_DOWNLOAD_PORT,
  type SpeechDownloadId,
  type SpeechDownloadSnapshot,
  type SpeechDownloadTask,
} from "@contextual/core";
import { EMPTY_SPEECH_DOWNLOAD_SNAPSHOT } from "./speech-download-constants";

export { EMPTY_SPEECH_DOWNLOAD_SNAPSHOT } from "./speech-download-constants";

export class SpeechDownloads {
  private connection:
    | { kind: "connected"; port: chrome.runtime.Port }
    | { kind: "disconnected" }
    | { kind: "closed" } = { kind: "disconnected" };
  private value: SpeechDownloadSnapshot = EMPTY_SPEECH_DOWNLOAD_SNAPSHOT;
  private listeners = new Set<() => void>();
  private noticeListeners = new Set<(task: SpeechDownloadTask) => void>();
  private pending = new Map<
    string,
    { resolve(id?: SpeechDownloadId): void; reject(error: Error): void }
  >();
  constructor(private readonly runtime: typeof chrome.runtime = chrome.runtime) {
    this.connect();
  }

  private connect(): chrome.runtime.Port {
    if (this.connection.kind === "connected") return this.connection.port;
    if (this.connection.kind === "closed") throw new Error("Speech download service is closed.");
    const port = this.runtime.connect({ name: SPEECH_DOWNLOAD_PORT });
    this.connection = { kind: "connected", port };
    port.onMessage.addListener(raw => {
      if (this.connection.kind !== "connected" || this.connection.port !== port) return;
      const parsed = SpeechDownloadViewMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      switch (message.type) {
        case "speechDownloadSnapshot":
          this.value = SpeechDownloadSnapshotSchema.parse(message);
          this.listeners.forEach(listener => listener());
          break;
        case "speechDownloadNotice":
          this.noticeListeners.forEach(listener => listener(message.task));
          break;
        case "speechDownloadReply": {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message.taskId);
          break;
        }
      }
    });
    port.onDisconnect.addListener(() => {
      if (this.connection.kind !== "connected" || this.connection.port !== port) return;
      this.connection = { kind: "disconnected" };
      this.fail(
        new Error(this.runtime.lastError?.message ?? "Speech download service disconnected."),
      );
    });
    port.postMessage({ type: "watch", id: crypto.randomUUID() });
    return port;
  }

  snapshot = (): SpeechDownloadSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  subscribeNotices = (listener: (task: SpeechDownloadTask) => void): (() => void) => {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  };

  private command(input: Record<string, unknown>): Promise<SpeechDownloadId | undefined> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.connect().postMessage({ ...input, id });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async start(voiceId: string): Promise<SpeechDownloadId> {
    const id = await this.command({ type: "start", voiceId });
    return SpeechDownloadIdSchema.parse(id);
  }
  async retry(taskId: SpeechDownloadId): Promise<SpeechDownloadId> {
    const id = await this.command({ type: "retry", taskId });
    return SpeechDownloadIdSchema.parse(id);
  }
  async cancel(taskId: SpeechDownloadId): Promise<void> {
    await this.command({ type: "cancel", taskId });
  }
  async clearEnded(taskIds: SpeechDownloadId[]): Promise<void> {
    await this.command({ type: "clearEnded", taskIds });
  }
  async reconcile(): Promise<void> {
    await this.command({ type: "reconcile" });
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.value = { ...this.value, ready: false, service: "unavailable" };
    this.listeners.forEach(listener => listener());
  }
  close(): void {
    if (this.connection.kind === "closed") return;
    const connected = this.connection;
    this.connection = { kind: "closed" };
    this.fail(new Error("Speech download service closed."));
    if (connected.kind === "connected") connected.port.disconnect();
    this.listeners.clear();
    this.noticeListeners.clear();
  }
}
