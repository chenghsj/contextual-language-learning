import { execFile, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { release } from "node:os";
import { z } from "zod";
import { SiriSpeechBackend } from "./siri-speech";
import { WindowsNarratorBackend } from "./windows-narrator";
import {
  SpeechInputSchema,
  SystemVoiceSchema,
  speechVoicesForLanguage,
  normalizeSystemVoices,
  findSystemVoice,
  type SpeechInput,
  type SpeechDownloadOperation,
  type SystemVoice,
} from "@contextual/core";

export type SpeechProcess = { completion: Promise<string>; stop(): void };
export type SpeechRunner = (
  command: string,
  args: string[],
  input?: string,
  timeout?: number,
) => SpeechProcess;

export const runSpeechProcess: SpeechRunner = (command, args, input = "", timeout = 300_000) => {
  const child = spawn(command, args, {
    shell: false,
    windowsHide: true,
    stdio: "pipe",
  });
  let stopped = false;
  let stdout = "";
  const timer = setTimeout(() => child.kill(), timeout);
  const completion = new Promise<string>((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      stdout += data;
      if (stdout.length > 1_000_000) child.kill();
    });
    // Drain stderr without exposing lesson text or platform diagnostics in the protocol.
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", () => reject(new Error("Could not start the system speech service.")));
    child.on("close", code => {
      clearTimeout(timer);
      if (stopped || code === 0) resolve(stdout);
      else reject(new Error("System speech failed. Check the installed voice and audio output."));
    });
    child.stdin.end(input);
  });
  return {
    completion,
    stop() {
      stopped = true;
      child.kill();
    },
  };
};

// esbuild bundles this module into dist/native-host.mjs. tsx development uses the same built helper.
const macSpeechPath = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".ts") ? "../../dist/macos-speech" : "./macos-speech",
    import.meta.url,
  ),
);

/** Probe configured developer tools without triggering the /usr/bin/swift install prompt. */
async function installedAppleSwift(): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)("/usr/bin/xcode-select", ["-p"], {
      timeout: 5000,
    });
    const developer = stdout.trim();
    if (!developer.startsWith("/")) return null;
    for (const relative of ["Toolchains/XcodeDefault.xctoolchain/usr/bin/swift", "usr/bin/swift"]) {
      const path = join(developer, relative);
      try {
        await access(path, constants.X_OK);
        return path;
      } catch {}
    }
  } catch {}
  return null;
}

type ActiveSpeech = {
  id: string;
  cancelled: boolean;
  process?: SpeechProcess;
  done: Promise<void>;
  finish(): void;
};

/** One process at a time, independent of the generation queue. */
export class SystemSpeechService {
  private voices?: SystemVoice[];
  private active?: ActiveSpeech;
  private closed = false;
  private processes = new Set<SpeechProcess>();
  private macBackend?: Promise<{ command: string; args: string[] }>;
  constructor(
    private platform: NodeJS.Platform = process.platform,
    private run: SpeechRunner = runSpeechProcess,
    private macHelper: string = macSpeechPath,
    private findSwift: () => Promise<string | null> = installedAppleSwift,
    private siri: SiriSpeechBackend | undefined = undefined,
    private systemRelease: string = release(),
  ) {
    if (!siri && platform === "darwin" && run === runSpeechProcess)
      this.siri = new SiriSpeechBackend((...args) => this.start(...args), macHelper + "-siri");
  }
  get experimentalBackend() {
    return this.platform === "win32" ? ("windows-narrator" as const) : undefined;
  }
  private windowsNarrator() {
    return new WindowsNarratorBackend((...args) => this.start(...args));
  }
  get supported(): boolean {
    return (
      this.platform === "win32" ||
      (this.platform === "darwin" && Number.parseInt(this.systemRelease, 10) >= 22)
    );
  }
  async listVoiceCatalog() {
    if (this.closed) throw new Error("Native Host connection closed.");
    return this.siri?.catalog() ?? { available: false, voices: [] };
  }
  async voiceFolder(voiceId: string) {
    if (this.closed) throw new Error("Speech service is closed.");
    if (!this.siri) throw new Error("Siri resource folders are unavailable on this platform.");
    return this.siri.resourceFolder(voiceId);
  }
  async openVoiceFolder(voiceId: string) {
    if (this.closed) throw new Error("Speech service is closed.");
    if (!this.siri) throw new Error("Siri resource folders are unavailable on this platform.");
    return this.siri.openResourceFolder(voiceId);
  }
  async removeVoice(voiceId: string) {
    if (this.closed) throw new Error("Native Host connection closed.");
    if (!this.siri) throw new Error("Siri resource removal is unavailable on this platform.");
    await this.siri.removeResource(voiceId);
    this.voices = undefined;
  }
  async installVoice(voiceId: string) {
    if (this.closed) throw new Error("Native Host connection closed.");
    if (!this.siri) throw new Error("Siri voice downloads are unavailable on this platform.");
    return this.siri.install(voiceId);
  }
  async startDownload(operation: SpeechDownloadOperation) {
    if (this.closed) throw new Error("Native Host connection closed.");
    if (!this.siri) throw new Error("Siri voice downloads are unavailable on this platform.");
    const observations = await this.siri.startDownload(operation);
    if (observations.some(observation => observation.resource === "installed"))
      this.voices = undefined;
    return observations;
  }
  async cancelDownload(operation: SpeechDownloadOperation) {
    if (this.closed) throw new Error("Native Host connection closed.");
    if (!this.siri) throw new Error("Siri voice downloads are unavailable on this platform.");
    return this.siri.cancelDownload(operation);
  }
  async inspectDownloads(operations: SpeechDownloadOperation[]) {
    if (this.closed) throw new Error("Native Host connection closed.");
    if (!this.siri) throw new Error("Siri voice downloads are unavailable on this platform.");
    const observations = await this.siri.inspectDownloads(operations);
    if (observations.some(observation => observation.resource === "installed"))
      this.voices = undefined;
    return observations;
  }
  async voiceInstallation(voiceId: string) {
    if (this.closed) throw new Error("Native Host connection closed.");
    if (!this.siri) throw new Error("Siri voice downloads are unavailable on this platform.");
    const result = await this.siri.status(voiceId);
    if (result.status === "installed") this.voices = undefined;
    return result;
  }
  private macCommand() {
    return (this.macBackend ??= this.findSwift().then(swift =>
      swift
        ? {
            command: swift,
            args: [
              "-module-cache-path",
              join(dirname(this.macHelper), "speech-module-cache"),
              this.macHelper + ".swift",
            ],
          }
        : { command: this.macHelper, args: [] },
    ));
  }
  private start(command: string, args: string[], input?: string, timeout?: number) {
    if (this.closed) throw new Error("Native Host connection closed.");
    const child = this.run(command, args, input, timeout);
    this.processes.add(child);
    void child.completion.finally(() => this.processes.delete(child)).catch(() => {});
    return child;
  }
  async listVoices(): Promise<SystemVoice[]> {
    if (this.closed) throw new Error("Native Host connection closed.");
    if (this.platform === "darwin") {
      const siriVoices = (await this.siri?.installed()) ?? [];
      const backend = await this.macCommand();
      const load = async (command: string, args: string[]) => {
        const output = await this.start(command, args, JSON.stringify({ action: "voices" }), 25_000)
          .completion;
        return z.array(SystemVoiceSchema).max(1000).parse(JSON.parse(output));
      };
      try {
        this.voices = await load(backend.command, backend.args);
      } catch (error) {
        // Older/broken developer tools must not disable the dependency-free native backend.
        if (this.closed) throw error;
        if (backend.command === this.macHelper) {
          if (!siriVoices.length) throw error;
          this.voices = [];
        } else {
          this.macBackend = Promise.resolve({
            command: this.macHelper,
            args: [],
          });
          this.voices = await load(this.macHelper, []).catch(error => {
            if (this.closed || !siriVoices.length) throw error;
            return [];
          });
        }
      }
      this.voices = [...siriVoices, ...this.voices];
    } else if (this.platform === "win32") {
      this.voices = await this.windowsNarrator().installed();
    } else throw new Error("System speech is available on macOS and Windows only.");
    this.voices = normalizeSystemVoices(this.voices);
    return this.voices;
  }
  stop(id: string): Promise<void> {
    const active = this.active;
    if (active?.id !== id) return Promise.resolve();
    active.cancelled = true;
    active.process?.stop();
    return active.done;
  }
  close(): void {
    this.closed = true;
    if (this.active) this.stop(this.active.id);
    for (const child of this.processes) child.stop();
  }
  async speak(id: string, raw: SpeechInput): Promise<"completed" | "stopped"> {
    const input = SpeechInputSchema.parse(raw);
    if (this.closed) throw new Error("Native Host connection closed.");
    const previous = this.active;
    if (previous) this.stop(previous.id);
    let finish!: () => void;
    const active: ActiveSpeech = {
      id,
      cancelled: false,
      done: new Promise(resolve => {
        finish = resolve;
      }),
      finish: () => finish(),
    };
    this.active = active;
    try {
      // Wait for the previous audio process to exit before starting its replacement.
      await previous?.done;
      if (active.cancelled) return "stopped";
      const voices = this.voices ?? (await this.listVoices());
      if (active.cancelled) return "stopped";
      const voice = findSystemVoice(speechVoicesForLanguage(voices, input.language), input.voiceId);
      if (!voice)
        throw new Error(
          "The selected system voice is unavailable for this language. Refresh voices in Settings.",
        );
      const useSiri = this.platform === "darwin" && voice.engine === "siri";
      const mac = this.platform === "darwin" && !useSiri ? await this.macCommand() : null;
      if (active.cancelled) return "stopped";
      active.process = useSiri
        ? this.siri!.speak({ ...input, voiceId: voice.id })
        : this.platform === "darwin"
          ? this.start(
              mac!.command,
              mac!.args,
              JSON.stringify({
                action: "speak",
                voiceId: input.voiceId,
                text: input.text,
                rate: input.rate,
              }),
            )
          : this.windowsNarrator().speak({ ...input, voiceId: voice.id }, voice.language);
      await active.process.completion;
      return active.cancelled ? "stopped" : "completed";
    } finally {
      active.finish();
      if (this.active === active) this.active = undefined;
    }
  }
}
