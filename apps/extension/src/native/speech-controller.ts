import {
  readAloudVoicesForLanguage,
  findSystemVoice,
  type HostRequest,
  type HostMessage,
  type SpeechSettings,
  type SystemVoice,
  type SpeechVoiceCatalog,
} from "@contextual/core";
import { openHostStream, type HostStream } from "./host-client";

export type SpeechState = {
  availability: "unknown" | "ready" | "unsupported" | "unavailable";
  voices: SystemVoice[] | null;
  experimentalBackend?: "windows-narrator";
  loading: boolean;
  active: { id: string; key: string; scope: string; phase: "preparing" | "speaking" } | null;
  error: string | null;
  errorKind: "service" | "voice" | null;
};
type OpenSpeechStream = (
  onMessage: (message: HostMessage | { type: "generationState" }) => void,
  onError: (error: Error) => void,
) => HostStream;
type Pending = {
  resolve(message: HostMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
class MissingSystemVoice extends Error {}

export const SPEECH_SEGMENT_PAUSE_MS = 500;

/** One panel-owned transport; cancellation targets the exact speech request. */
export class SpeechController {
  private prepare?: (isCurrent: () => boolean) => Promise<void>;
  setBeforeSpeak(prepare: (isCurrent: () => boolean) => Promise<void>) {
    this.prepare = prepare;
    return () => {
      if (this.prepare === prepare) this.prepare = undefined;
    };
  }
  private stream?: HostStream;
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private intentScope: string | null = null;
  private pause?: {
    timer: ReturnType<typeof setTimeout>;
    resolve(): void;
    reject(error: Error): void;
  };
  private listing?: Promise<SystemVoice[]>;
  private value: SpeechState = {
    availability: "unknown",
    voices: null,
    loading: false,
    active: null,
    error: null,
    errorKind: null,
  };
  constructor(private open: OpenSpeechStream = openHostStream) {}
  snapshot = (): SpeechState => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<SpeechState>) {
    this.value = { ...this.value, ...change };
    this.listeners.forEach(listener => listener());
  }
  private request(request: HostRequest): Promise<HostMessage> {
    return new Promise((resolve, reject) => {
      try {
        this.stream ??= this.open(
          message => {
            if (message.type === "generationState") return;
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.type === "error") pending.reject(new Error(message.message));
            else pending.resolve(message);
          },
          error => this.fail(error),
        );
        const timer = setTimeout(
          () => {
            this.fail(new Error("System speech did not respond. Reconnect the local service."));
          },
          request.type === "speak"
            ? 310_000
            : request.type === "listSpeechVoices"
              ? 90_000
              : [
                    "listSpeechVoiceCatalog",
                    "installSpeechVoice",
                    "getSpeechVoiceInstallation",
                    "getSpeechVoiceFolder",
                    "openSpeechVoiceFolder",
                    "removeSpeechVoice",
                  ].includes(request.type)
                ? 60_000
                : 30_000,
        );
        this.pending.set(request.id, { resolve, reject, timer });
        this.stream.send(request);
      } catch (error) {
        const pending = this.pending.get(request.id);
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(request.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  private fail(error: Error) {
    this.clearPause(error);
    this.update({ availability: "unavailable", voices: null });
    const stream = this.stream;
    this.stream = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    stream?.close();
  }
  listVoices(refresh = false): Promise<SystemVoice[]> {
    if (this.listing) return this.listing;
    if (!refresh && this.value.voices) return Promise.resolve(this.value.voices);
    this.update({ loading: true, error: null, errorKind: null });
    this.listing = this.request({ id: crypto.randomUUID(), type: "listSpeechVoices" })
      .then(message => {
        if (message.type !== "speechVoices") throw new Error("Invalid system voice response.");
        this.update({
          voices: message.voices,
          experimentalBackend: message.experimentalBackend,
          availability: message.supported === false ? "unsupported" : "ready",
        });
        return message.voices;
      })
      .catch(error => {
        this.update({
          availability: "unavailable",
          voices: null,
          error: String(error instanceof Error ? error.message : error),
          errorKind: "service",
        });
        throw error;
      })
      .finally(() => {
        this.listing = undefined;
        this.update({ loading: false });
      });
    return this.listing;
  }
  async listVoiceCatalog(): Promise<SpeechVoiceCatalog> {
    const message = await this.request({ id: crypto.randomUUID(), type: "listSpeechVoiceCatalog" });
    if (message.type !== "speechVoiceCatalog")
      throw new Error("Invalid Siri voice catalog response.");
    return message.catalog;
  }
  async voiceFolder(voiceId: string): Promise<string> {
    const message = await this.request({
      id: crypto.randomUUID(),
      type: "getSpeechVoiceFolder",
      voiceId,
    });
    if (message.type !== "speechVoiceFolder" || message.voiceId !== voiceId)
      throw new Error("Invalid Siri resource folder response.");
    return message.directory;
  }
  async openVoiceFolder(voiceId: string): Promise<string> {
    const message = await this.request({
      id: crypto.randomUUID(),
      type: "openSpeechVoiceFolder",
      voiceId,
    });
    if (message.type !== "speechVoiceFolderOpened" || message.voiceId !== voiceId)
      throw new Error("Invalid Siri resource folder response.");
    return message.directory;
  }
  async removeVoice(voiceId: string): Promise<void> {
    await this.stop();
    const message = await this.request({
      id: crypto.randomUUID(),
      type: "removeSpeechVoice",
      voiceId,
    });
    if (message.type !== "speechVoiceRemoved" || message.voiceId !== voiceId)
      throw new Error("Invalid Siri resource removal response.");
    // Finish a pre-removal query before clearing its potentially stale result.
    if (this.listing) await this.listing.catch(() => {});
    this.update({ voices: null });
  }
  private async stopCurrent(): Promise<void> {
    this.clearPause();
    const active = this.value.active;
    this.update({ active: null });
    if (!active || !this.pending.has(active.id)) return;
    await this.request({ id: crypto.randomUUID(), type: "stopSpeech", speechId: active.id });
  }
  async stop(scope?: string): Promise<void> {
    if (scope && (this.intentScope ?? this.value.active?.scope) !== scope) return;
    this.revision++;
    this.intentScope = null;
    await this.stopCurrent();
  }
  private clearPause(error?: Error): void {
    const pause = this.pause;
    if (!pause) return;
    this.pause = undefined;
    clearTimeout(pause.timer);
    if (error) pause.reject(error);
    else pause.resolve();
  }
  private pauseBetweenSegments(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pause = undefined;
        resolve();
      }, SPEECH_SEGMENT_PAUSE_MS);
      this.pause = { timer, resolve, reject };
    });
  }
  async speak(
    key: string,
    scope: string,
    text: string,
    language: string,
    settings: SpeechSettings,
    beforeSpeak?: (isCurrent: () => boolean) => Promise<void>,
    exactVoiceId?: string,
    segments?: readonly string[],
  ): Promise<void> {
    const revision = ++this.revision;
    this.intentScope = scope;
    const id = crypto.randomUUID();
    // Explicit dialogue lines preserve internal wraps and punctuation within each line.
    const texts = segments ? segments.filter(segment => segment.trim()) : [text];
    try {
      await this.stopCurrent();
      if (revision !== this.revision) return;
      this.update({ active: { id, key, scope, phase: "preparing" }, error: null, errorKind: null });
      const voices = readAloudVoicesForLanguage(await this.listVoices(), language);
      if (revision !== this.revision) return;
      const saved = settings.voices[language];
      // Voice previews must never silently play a different voice.
      const voice = exactVoiceId
        ? findSystemVoice(voices, exactVoiceId)
        : (findSystemVoice(voices, saved) ?? voices[0]);
      if (!voice)
        throw new MissingSystemVoice(
          "No high-quality system voice is available for this language.",
        );
      await (beforeSpeak ?? this.prepare)?.(() => revision === this.revision);
      if (revision !== this.revision) return;
      for (const [index, segment] of texts.entries()) {
        if (revision !== this.revision) return;
        const segmentId = index === 0 ? id : crypto.randomUUID();
        this.update({ active: { id: segmentId, key, scope, phase: "speaking" } });
        const result = await this.request({
          id: segmentId,
          type: "speak",
          input: { text: segment, language, voiceId: voice.id, rate: settings.rate },
        });
        if (revision !== this.revision) return;
        if (result.type !== "speechFinished") throw new Error("Invalid system speech response.");
        if (result.status === "stopped") return;
        if (index + 1 < texts.length) await this.pauseBetweenSegments();
      }
    } catch (error) {
      if (revision === this.revision)
        this.update({
          error: error instanceof Error ? error.message : String(error),
          errorKind: error instanceof MissingSystemVoice ? "voice" : "service",
        });
    } finally {
      if (revision === this.revision) {
        this.intentScope = null;
        this.update({ active: null });
      }
    }
  }
  dispose() {
    this.revision++;
    this.intentScope = null;
    this.fail(new Error("Speech controls closed."));
    this.update({ active: null });
  }
}
