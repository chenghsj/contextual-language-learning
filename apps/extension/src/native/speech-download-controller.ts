import {
  findSystemVoice,
  isSpeechDownloadActive,
  speechDownloadMatchesVoice,
  SpeechDownloadCommandSchema,
  SpeechDownloadIdSchema,
  SpeechDownloadSnapshotSchema,
  SpeechDownloadStoreSchema,
  type StoredSpeechDownload,
  SpeechDownloadObservationSchema,
  SPEECH_DOWNLOAD_PORT,
  type HostMessage,
  type SpeechDownloadId,
  type SpeechDownloadObservation,
  type SpeechDownloadSnapshot,
  type SpeechDownloadTask,
  type SystemVoice,
} from "@contextual/core";
import type { BackgroundHostGateway } from "./generation-controller";
export { EMPTY_SPEECH_DOWNLOAD_SNAPSHOT } from "./speech-download-constants";

export const SPEECH_DOWNLOAD_STORAGE_KEY = "speechDownloads.v1";
type RecordEntry = StoredSpeechDownload;
type Envelope = { version: 1; records: RecordEntry[] };
type Storage = Pick<typeof chrome.storage.local, "get" | "set">;
type Runtime = Pick<typeof chrome.runtime, "onConnect" | "id">;
type ViewPort = chrome.runtime.Port;

function now() {
  return new Date().toISOString();
}
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function responseObservations(
  message: HostMessage,
  operations: readonly { operationId: SpeechDownloadId; voiceId: string }[],
): SpeechDownloadObservation[] {
  if (message.type !== "speechDownloadObservations")
    throw new Error("Invalid speech download response.");
  const observations = message.observations.map(raw => SpeechDownloadObservationSchema.parse(raw));
  if (observations.length !== operations.length)
    throw new Error("Incomplete speech download observations.");
  for (const operation of operations) {
    if (
      !observations.some(
        item => item.operationId === operation.operationId && item.voiceId === operation.voiceId,
      )
    )
      throw new Error("Mismatched speech download observation.");
  }
  return observations;
}

export class SpeechDownloadController {
  private records: RecordEntry[] = [];
  private revision = 0;
  private service: SpeechDownloadSnapshot["service"] = "reconciling";
  private paused = false;
  private ready = false;
  private loaded = false;
  private loading?: Promise<void>;
  private fatalStorage = false;
  private queue: Promise<unknown> = Promise.resolve();
  private views = new Set<ViewPort>();
  private lease?: () => void;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private inspecting = false;
  private failures = 0;
  private requestEpoch = new Map<string, number>();
  private inFlightStarts = new Set<SpeechDownloadId>();

  constructor(
    private readonly gateway: BackgroundHostGateway,
    private readonly storage: Storage = chrome.storage.local,
    private readonly runtime: Runtime = chrome.runtime,
    private readonly timers: {
      set(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
      clear(timer: ReturnType<typeof setTimeout>): void;
    } = {
      set: (callback, delay) => setTimeout(callback, delay),
      clear: timer => clearTimeout(timer),
    },
  ) {}

  snapshot(): SpeechDownloadSnapshot {
    return SpeechDownloadSnapshotSchema.parse({
      type: "speechDownloadSnapshot",
      ready: this.ready,
      revision: this.revision,
      service: this.service,
      paused: this.paused,
      tasks: this.records.map(record => record.task),
    });
  }

  async install(): Promise<void> {
    this.runtime.onConnect.addListener(port => this.connect(port));
    await this.load();
  }

  private load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    this.loading ??= this.readStorage();
    return this.loading;
  }

  private async readStorage(): Promise<void> {
    try {
      const raw = await this.storage.get(SPEECH_DOWNLOAD_STORAGE_KEY);
      const saved = raw[SPEECH_DOWNLOAD_STORAGE_KEY];
      if (saved !== undefined)
        this.records = SpeechDownloadStoreSchema.parse(saved).records.map(record => ({
          ...record,
          task: isSpeechDownloadActive(record.task)
            ? { ...record.task, observation: { kind: "reconciling" } }
            : record.task,
        }));
      this.loaded = true;
      this.ready = true;
      this.service = "ready";
      this.publish();
      if (this.records.some(record => this.needsWork(record)))
        void this.reconcile(false, false).catch(() => {});
    } catch {
      this.fatalStorage = true;
      this.loaded = true;
      this.ready = true;
      this.service = "storage-error";
      this.publish();
    }
  }

  private connect(port: ViewPort): void {
    if (port.name !== SPEECH_DOWNLOAD_PORT) return;
    let trusted = false;
    try {
      const sender = new URL(port.sender?.url ?? "");
      trusted =
        sender.protocol === "chrome-extension:" &&
        sender.hostname === this.runtime.id &&
        sender.pathname === "/sidepanel.html" &&
        !port.sender?.tab;
    } catch {}
    if (!trusted || (port.sender?.id && port.sender.id !== this.runtime.id)) {
      port.disconnect();
      return;
    }
    this.views.add(port);
    port.onDisconnect.addListener(() => this.views.delete(port));
    port.onMessage.addListener((raw: unknown) => {
      const parsed = SpeechDownloadCommandSchema.safeParse(raw);
      if (!parsed.success) return;
      const command = parsed.data;
      if (command.type === "watch") {
        port.postMessage(this.snapshot());
        if (this.paused || this.service === "unavailable") void this.reconcile().catch(() => {});
        return;
      }
      void (async () => {
        try {
          if (!this.loaded) await this.load();
          let taskId: SpeechDownloadId | undefined;
          switch (command.type) {
            case "start":
              taskId = await this.start(command.voiceId);
              break;
            case "retry":
              taskId = await this.retry(command.taskId);
              break;
            case "cancel":
              await this.cancel(command.taskId);
              break;
            case "clearEnded":
              await this.clearEnded(command.taskIds);
              break;
            case "reconcile":
              await this.reconcile();
              break;
          }
          port.postMessage({
            type: "speechDownloadReply",
            id: command.id,
            ...(taskId ? { taskId } : {}),
          });
        } catch (error) {
          port.postMessage({
            type: "speechDownloadReply",
            id: command.id,
            error: failureMessage(error),
          });
        }
      })();
    });
    if (this.loaded) port.postMessage(this.snapshot());
  }

  private publish(previous?: Map<SpeechDownloadId, SpeechDownloadTask>): void {
    this.revision++;
    const snapshot = this.snapshot();
    for (const port of this.views) {
      try {
        port.postMessage(snapshot);
        if (previous)
          for (const task of snapshot.tasks) {
            const old = previous.get(task.id);
            if (old && isSpeechDownloadActive(old) && !isSpeechDownloadActive(task))
              port.postMessage({ type: "speechDownloadNotice", task });
          }
      } catch {
        this.views.delete(port);
      }
    }
    this.maintainPolling();
  }

  private commit<T>(change: (records: RecordEntry[]) => T, notices = true): Promise<T> {
    const run = async () => {
      if (this.fatalStorage)
        throw new Error("Speech download history is unavailable. Existing records were preserved.");
      const previous = new Map(this.records.map(record => [record.task.id, record.task]));
      const next = structuredClone(this.records);
      const result = change(next);
      const envelope: Envelope = { version: 1, records: next };
      SpeechDownloadStoreSchema.parse(envelope);
      try {
        await this.storage.set({ [SPEECH_DOWNLOAD_STORAGE_KEY]: envelope });
      } catch (error) {
        this.fatalStorage = true;
        this.service = "storage-error";
        this.publish();
        throw error;
      }
      this.records = next;
      this.publish(notices ? previous : undefined);
      return result;
    };
    const promise = this.queue.then(run, run);
    this.queue = promise.catch(() => {});
    return promise;
  }

  private async catalog(): Promise<SystemVoice[]> {
    const message = await this.gateway.request({
      type: "listSpeechVoiceCatalog",
      id: crypto.randomUUID(),
    });
    if (message.type !== "speechVoiceCatalog" || !message.catalog.available)
      throw new Error("Siri voice catalog is unavailable.");
    return message.catalog.voices;
  }

  async start(voiceId: string): Promise<SpeechDownloadId> {
    if (!this.loaded) await this.load();
    if (this.fatalStorage) throw new Error("Speech download history is unavailable.");
    const voice = findSystemVoice(await this.catalog(), voiceId);
    if (!voice || voice.engine !== "siri")
      throw new Error("Siri voice was not found in the current catalog.");
    if (voice.installed === true || voice.resourceAvailable === true)
      throw new Error("This Siri voice resource is already downloaded.");
    const id = SpeechDownloadIdSchema.parse(crypto.randomUUID());
    const created = await this.commit(records => {
      const duplicate = records.find(
        record =>
          isSpeechDownloadActive(record.task) && speechDownloadMatchesVoice(record.task, voice),
      );
      if (duplicate) return { id: duplicate.task.id, created: false };
      const at = now();
      records.push({
        task: {
          id,
          voice,
          createdAt: at,
          updatedAt: at,
          progress: { status: "requesting" },
          observation: { kind: "reconciling" },
        },
        dispatch: "intent",
        cancelRequested: false,
        sawSubscription: false,
        withdrawalSettled: false,
      });
      return { id, created: true };
    });
    if (created.created) void this.dispatchStart(created.id);
    return created.id;
  }

  async retry(taskId: SpeechDownloadId): Promise<SpeechDownloadId> {
    const original = this.records.find(record => record.task.id === taskId);
    if (
      !original ||
      (original.task.progress.status !== "failed" && original.task.progress.status !== "cancelled")
    )
      throw new Error("Only failed or cancelled downloads can be retried.");
    {
      await this.commit(records => {
        const record = records.find(item => item.task.id === taskId);
        if (!record) throw new Error("Download task was not found.");
        record.cancelRequested = true;
        record.withdrawalSettled = false;
      });
      const operation = {
        operationId: taskId,
        voiceId: original.task.voice.id,
      };
      responseObservations(
        await this.gateway.request({
          type: "cancelSpeechDownload",
          id: crypto.randomUUID(),
          ...operation,
        }),
        [operation],
      );
      const inspected = responseObservations(
        await this.gateway.request({
          type: "inspectSpeechDownloads",
          id: crypto.randomUUID(),
          operations: [operation],
        }),
        [operation],
      )[0];
      await this.applyObservations([inspected], false);
      if (
        !inspected.cancelFenced ||
        inspected.subscription !== "absent" ||
        inspected.ordering !== "settled"
      )
        throw new Error(
          "The previous voice request has not settled. Reconcile it before retrying.",
        );
    }
    return this.start(original.task.voice.id);
  }

  async cancel(taskId: SpeechDownloadId): Promise<void> {
    await this.commit(records => {
      const record = records.find(item => item.task.id === taskId);
      if (!record) throw new Error("Download task was not found.");
      if (!isSpeechDownloadActive(record.task)) return;
      record.cancelRequested = true;
      record.withdrawalSettled = false;
      record.task.progress = { status: "cancelling" };
      record.task.observation = { kind: "reconciling" };
      record.task.updatedAt = now();
    });
    void this.dispatchCancel(taskId);
  }

  async clearEnded(taskIds: SpeechDownloadId[]): Promise<void> {
    await this.commit(records => {
      const ids = new Set(taskIds);
      for (const record of records)
        if (ids.has(record.task.id) && this.needsWork(record))
          throw new Error("Active downloads cannot be cleared.");
      for (let index = records.length - 1; index >= 0; index--)
        if (ids.has(records[index].task.id)) records.splice(index, 1);
    });
  }

  private async dispatchStart(taskId: SpeechDownloadId): Promise<void> {
    this.inFlightStarts.add(taskId);
    const epoch = this.nextEpoch(taskId);
    try {
      await this.commit(records => {
        const record = records.find(item => item.task.id === taskId);
        if (record && record.dispatch === "intent") record.dispatch = "may-have-been-sent";
      });
      const record = this.records.find(item => item.task.id === taskId);
      if (!record || record.cancelRequested) return;
      const operation = { operationId: taskId, voiceId: record.task.voice.id };
      const reply = await this.gateway.request({
        type: "startSpeechDownload",
        id: crypto.randomUUID(),
        ...operation,
      });
      if (this.requestEpoch.get(taskId) !== epoch) return;
      await this.applyObservations(responseObservations(reply, [operation]), true);
      this.failures = 0;
      this.service = "ready";
      this.publish();
    } catch {
      this.markUnavailable();
    } finally {
      this.inFlightStarts.delete(taskId);
    }
  }

  private async dispatchCancel(taskId: SpeechDownloadId): Promise<void> {
    const record = this.records.find(item => item.task.id === taskId);
    if (!record || !record.cancelRequested || record.withdrawalSettled) return;
    const operation = { operationId: taskId, voiceId: record.task.voice.id };
    const epoch = this.nextEpoch(taskId);
    try {
      const reply = await this.gateway.request({
        type: "cancelSpeechDownload",
        id: crypto.randomUUID(),
        ...operation,
      });
      if (this.requestEpoch.get(taskId) !== epoch) return;
      await this.applyObservations(responseObservations(reply, [operation]), true);
      this.failures = 0;
      this.service = "ready";
      this.publish();
    } catch {
      this.markUnavailable();
    }
  }

  private nextEpoch(taskId: SpeechDownloadId): number {
    const epoch = (this.requestEpoch.get(taskId) ?? 0) + 1;
    this.requestEpoch.set(taskId, epoch);
    return epoch;
  }

  private async applyObservations(
    observations: SpeechDownloadObservation[],
    notices: boolean,
    epochs?: ReadonlyMap<SpeechDownloadId, number | undefined>,
  ): Promise<void> {
    const checkedAt = now();
    await this.commit(records => {
      for (const observation of observations) {
        if (
          epochs &&
          epochs.get(observation.operationId) !== this.requestEpoch.get(observation.operationId)
        )
          continue;
        const record = records.find(
          item =>
            item.task.id === observation.operationId && item.task.voice.id === observation.voiceId,
        );
        if (!record) continue;
        if (
          record.cancelRequested &&
          observation.cancelFenced &&
          observation.subscription === "absent" &&
          observation.ordering === "settled"
        )
          record.withdrawalSettled = true;
        if (!isSpeechDownloadActive(record.task)) continue;
        const previous = record.task.progress.status;
        record.sawSubscription ||= observation.subscription === "present";
        record.task.observation = { kind: "fresh", checkedAt };
        record.task.updatedAt = checkedAt;
        if (observation.resource === "installed")
          record.task.progress = { status: "completed", endedAt: checkedAt };
        else if (record.cancelRequested) {
          record.task.progress =
            observation.cancelFenced &&
            observation.subscription === "absent" &&
            observation.ordering === "settled"
              ? {
                  status: "cancelled",
                  endedAt: checkedAt,
                  shared: observation.shared,
                }
              : { status: "cancelling" };
        } else if (
          observation.resource === "downloaded-unusable" &&
          observation.ordering === "settled"
        )
          record.task.progress = {
            status: "failed",
            endedAt: checkedAt,
            reason: "resource-unavailable",
          };
        else if (observation.subscription === "present")
          record.task.progress = { status: "waiting-system" };
        else if (
          record.dispatch === "intent" ||
          (observation.ordering === "settled" && record.sawSubscription)
        )
          record.task.progress = {
            status: "failed",
            endedAt: checkedAt,
            reason: "subscription-lost",
          };
        else if (observation.ordering === "settled" && record.dispatch === "may-have-been-sent")
          record.task.progress = {
            status: "failed",
            endedAt: checkedAt,
            reason: "rejected",
          };
        else
          record.task.progress = {
            status: previous === "waiting-system" ? "waiting-system" : "requesting",
          };
      }
    }, notices);
  }

  async reconcile(manual = true, notices = true): Promise<void> {
    if (!this.loaded) await this.load();
    if (this.fatalStorage) throw new Error("Speech download history is unavailable.");
    if (manual) {
      this.failures = 0;
      this.paused = false;
    }
    if (this.inspecting) return;
    this.inspecting = true;
    this.paused = false;
    this.service = "reconciling";
    this.publish();
    try {
      const withdrawals = this.records.filter(
        record => record.cancelRequested && !record.withdrawalSettled,
      );
      for (const record of withdrawals) {
        const operation = {
          operationId: record.task.id,
          voiceId: record.task.voice.id,
        };
        const reply = await this.gateway.request({
          type: "cancelSpeechDownload",
          id: crypto.randomUUID(),
          ...operation,
        });
        await this.applyObservations(responseObservations(reply, [operation]), notices);
      }
      const operations = this.records
        .filter(
          record =>
            this.needsWork(record) &&
            (!this.inFlightStarts.has(record.task.id) || record.cancelRequested),
        )
        .map(record => ({
          operationId: record.task.id,
          voiceId: record.task.voice.id,
        }));
      if (operations.length === 0) {
        this.failures = 0;
        this.service = "ready";
        return;
      }
      for (let index = 0; index < operations.length; index += 32) {
        const batch = operations.slice(index, index + 32);
        const epochs = new Map(
          batch.map(operation => [
            operation.operationId,
            this.requestEpoch.get(operation.operationId),
          ]),
        );
        const reply = await this.gateway.request({
          type: "inspectSpeechDownloads",
          id: crypto.randomUUID(),
          operations: batch,
        });
        await this.applyObservations(responseObservations(reply, batch), notices, epochs);
      }
      this.failures = 0;
      this.service = "ready";
    } catch (error) {
      this.failures++;
      this.service = this.fatalStorage ? "storage-error" : "unavailable";
      if (this.failures >= 3) this.paused = true;
      throw error;
    } finally {
      this.inspecting = false;
      this.publish();
    }
  }

  private markUnavailable(): void {
    this.service = this.fatalStorage ? "storage-error" : "unavailable";
    this.publish();
  }

  private needsWork(record: RecordEntry): boolean {
    return (
      isSpeechDownloadActive(record.task) || (record.cancelRequested && !record.withdrawalSettled)
    );
  }

  private maintainPolling(): void {
    const active = this.records.some(record => this.needsWork(record));
    if (!active || this.paused || this.fatalStorage) {
      if (this.pollTimer) this.timers.clear(this.pollTimer);
      this.pollTimer = undefined;
      this.lease?.();
      this.lease = undefined;
      return;
    }
    this.lease ??= this.gateway.retain();
    if (this.inspecting || this.pollTimer) return;
    this.pollTimer = this.timers.set(() => {
      this.pollTimer = undefined;
      void this.reconcile(false).catch(() => {});
    }, 5_000);
  }
}

export function installSpeechDownloadController(
  gateway: BackgroundHostGateway,
): SpeechDownloadController {
  const controller = new SpeechDownloadController(gateway);
  void controller.install();
  return controller;
}
