import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { release } from "node:os";
import { z } from "zod";
import {
  SystemVoiceSchema,
  SpeechDownloadOperationSchema,
  SpeechDownloadObservationSchema,
  type SpeechDownloadOperation,
  type SpeechDownloadObservation,
  normalizeSystemVoices,
  findSystemVoice,
  type SystemVoice,
  type SpeechInput,
  type SpeechVoiceCatalog,
  type SpeechVoiceInstallation,
} from "@contextual/core";
import type { SpeechRunner, SpeechProcess } from "./speech";
import { openSiriResourceFolder, validateSiriResourceFolder } from "./siri-resource-folder";

/** A separate process keeps private Siri ABI failures outside the Native Host. */
export class SiriSpeechBackend {
  constructor(
    private run: SpeechRunner,
    private helper: string,
    private supported: () => boolean = () =>
      process.platform === "darwin" &&
      process.arch === "arm64" &&
      Number(release().split(".")[0]) >= 25,
    private openFolder: (directory: string) => Promise<string> = openSiriResourceFolder,
    private validateFolder: (directory: string) => Promise<string> = validateSiriResourceFolder,
  ) {}
  private async available() {
    if (!this.supported()) return false;
    try {
      await access(this.helper, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  private start(action: string, input: object = {}, timeout = 30_000): SpeechProcess {
    return this.run(this.helper, [], JSON.stringify({ action, ...input }), timeout);
  }
  private catalogRequest?: Promise<SpeechVoiceCatalog>;
  catalog(): Promise<SpeechVoiceCatalog> {
    if (!this.catalogRequest) {
      this.catalogRequest = this.readCatalog().finally(() => {
        this.catalogRequest = undefined;
      });
    }
    return this.catalogRequest;
  }
  private async readCatalog(): Promise<SpeechVoiceCatalog> {
    if (!(await this.available())) return { available: false, voices: [] };
    try {
      const output = await this.start("catalog").completion;
      const voices = z.array(SystemVoiceSchema).max(1000).parse(JSON.parse(output));
      // Never promote a legacy voice merely because Apple calls its quality premium.
      return {
        available: true,
        voices: normalizeSystemVoices(
          voices.filter(
            voice =>
              voice.engine === "siri" &&
              voice.neural === true &&
              ["neural", "neuralAX", "natural", "fmvoice"].includes(voice.technology ?? ""),
          ),
        ),
      };
    } catch {
      return { available: false, voices: [] };
    }
  }
  async startDownload(operation: SpeechDownloadOperation): Promise<SpeechDownloadObservation[]> {
    return this.downloadOperation("startSpeechDownload", [operation]);
  }
  async cancelDownload(operation: SpeechDownloadOperation): Promise<SpeechDownloadObservation[]> {
    return this.downloadOperation("cancelSpeechDownload", [operation]);
  }
  async inspectDownloads(
    operations: SpeechDownloadOperation[],
  ): Promise<SpeechDownloadObservation[]> {
    return this.downloadOperation("inspectSpeechDownloads", operations);
  }
  private async downloadOperation(
    action: "startSpeechDownload" | "cancelSpeechDownload" | "inspectSpeechDownloads",
    raw: SpeechDownloadOperation[],
  ): Promise<SpeechDownloadObservation[]> {
    const operations = z.array(SpeechDownloadOperationSchema).min(1).max(32).parse(raw);
    if (
      new Set(operations.map(operation => operation.operationId.toLowerCase())).size !==
      operations.length
    )
      throw new Error("Duplicate Siri download operation.");
    if (!(await this.available()))
      throw new Error("Siri voice downloads are unavailable on this Mac.");
    const input = action === "inspectSpeechDownloads" ? { operations } : operations[0];
    const result = z
      .object({
        speechDownloadObservations: z.array(SpeechDownloadObservationSchema).min(1).max(32),
      })
      .parse(JSON.parse(await this.start(action, input, 60_000).completion));
    const observations = result.speechDownloadObservations;
    if (
      observations.length !== operations.length ||
      observations.some(
        (observation, index) =>
          observation.operationId !== operations[index].operationId ||
          observation.voiceId !== operations[index].voiceId,
      )
    )
      throw new Error("Invalid Siri download observation identity.");
    return observations;
  }
  async installed(): Promise<SystemVoice[]> {
    return (await this.catalog()).voices.filter(voice => voice.installed === true);
  }
  async resourceFolder(voiceId: string): Promise<string> {
    if (!(await this.available())) throw new Error("Siri resource folders are unavailable.");
    const result = z
      .object({
        voiceId: z.string().min(1).max(256),
        directory: z.string().min(1).max(4096),
      })
      .parse(JSON.parse(await this.start("resourceFolder", { voiceId }).completion));
    if (result.voiceId !== voiceId) throw new Error("Invalid Siri resource response.");
    return this.validateFolder(result.directory);
  }
  async openResourceFolder(voiceId: string): Promise<string> {
    return this.openFolder(await this.resourceFolder(voiceId));
  }
  async removeResource(voiceId: string): Promise<void> {
    const voice = findSystemVoice((await this.catalog()).voices, voiceId);
    if (!voice?.resourceAvailable || !voice.removable)
      throw new Error("SIRI_RESOURCE_NOT_REMOVABLE");
    const result = z
      .object({
        voiceId: z.string().min(1).max(256),
        status: z.enum(["removed", "not-removed"]),
      })
      .parse(JSON.parse(await this.start("removeResource", { voiceId }).completion));
    if (result.voiceId !== voiceId || result.status !== "removed")
      throw new Error("SIRI_RESOURCE_NOT_REMOVED");
  }
  async install(voiceId: string): Promise<SpeechVoiceInstallation> {
    const catalog = await this.catalog();
    const voice = findSystemVoice(catalog.voices, voiceId);
    if (!catalog.available || !voice)
      throw new Error("The Siri voice is unavailable. Refresh the voice catalog.");
    if (voice.installed) return { voiceId, status: "installed" };
    // An old helper may see physical assets but fail to resolve them for speech.
    // Never resubscribe (and potentially redownload) merely to repair discovery.
    if (voice.resourceAvailable) throw new Error("SIRI_RESOURCE_ALREADY_DOWNLOADED");
    const output = await this.start("install", { voiceId }).completion;
    const result = z
      .discriminatedUnion("status", [
        z.object({ status: z.literal("requested") }),
        z.object({ status: z.literal("installed") }),
        z.object({
          status: z.literal("rejected"),
          reason: z.enum(["missing-client-identity", "request-timed-out", "download-rejected"]),
          domain: z
            .string()
            .regex(/^[A-Za-z0-9._-]{1,100}$/)
            .nullable()
            .optional(),
          code: z.number().int().nullable().optional(),
        }),
      ])
      .parse(JSON.parse(output));
    if (result.status === "rejected") {
      const diagnostic =
        result.domain && result.code != null ? ` (${result.domain}:${result.code})` : "";
      const code = {
        "missing-client-identity": "SIRI_DOWNLOAD_MISSING_CLIENT_IDENTITY",
        "request-timed-out": "SIRI_DOWNLOAD_REQUEST_TIMED_OUT",
        "download-rejected": "SIRI_DOWNLOAD_REJECTED",
      }[result.reason];
      throw new Error(code + diagnostic);
    }
    return { voiceId, status: result.status };
  }
  async status(voiceId: string): Promise<SpeechVoiceInstallation> {
    if (!(await this.available()))
      throw new Error("Siri voice downloads are unavailable on this Mac.");
    const voice = SystemVoiceSchema.parse(
      JSON.parse(await this.start("status", { voiceId }).completion),
    );
    if (voice.id !== voiceId || voice.engine !== "siri")
      throw new Error("Invalid Siri installation response.");
    return {
      voiceId,
      status: voice.installed === true ? "installed" : "not-installed",
    };
  }
  speak(input: SpeechInput): SpeechProcess {
    return this.start(
      "speak",
      { voiceId: input.voiceId, text: input.text, rate: input.rate },
      300_000,
    );
  }
}
