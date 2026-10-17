import {
  GenerationRequestSchema,
  CustomGenerationRequestSchema,
  type CustomGenerationRequest,
  type CustomDocument,
  type GenerationRequest,
  type HostMessage,
  type LearningDocument,
  type DuplicateMatch,
  type JobSummary,
} from "@contextual/core";
import { getDocument, getCustomResource, openHostStream, type HostStream } from "./host-client";
import { CustomChunkAssembler } from "./custom-chunks";
import { DocumentChunkAssembler } from "./document-chunks";
import type { GenerationControllerState } from "./generation-controller";
import { CancellationTracker, type CancellationState } from "./cancellation-tracker";

export type GenerationInput = GenerationRequest | CustomGenerationRequest;
const isCustom = (input: GenerationInput): input is CustomGenerationRequest =>
  "kind" in input && input.kind === "custom";
export type GenerationState = {
  active: GenerationControllerState["active"];
  queue?: GenerationControllerState["queue"];
  connection?: GenerationControllerState["connection"];
  cancellations?: CancellationState;
  lastJobId: string | null;
  checking: boolean;
  submitting?: boolean;
  duplicate: { payload: GenerationInput; token: string; matches: DuplicateMatch[] } | null;
};
export type GenerationEvent =
  | { type: "state"; state: GenerationState }
  | { type: "document"; document: LearningDocument }
  | { type: "customDocument"; document: CustomDocument }
  | { type: "admitted"; job: JobSummary }
  | HostMessage;

function freezeRequest<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeRequest(child);
    Object.freeze(value);
  }
  return value;
}

/** Owns one panel subscription, immutable duplicate checks and exactly-once document delivery. */
export class GenerationSession {
  private port: HostStream | null = null;
  private state: GenerationState = {
    active: null,
    lastJobId: null,
    checking: false,
    duplicate: null,
  };
  private listeners = new Set<(event: GenerationEvent) => void>();
  private awaitingAdmission: string | null = null;
  private preflight: { id: string; payload: GenerationInput; confirmed?: boolean } | null = null;
  private customChunks = new Map<string, CustomChunkAssembler>();
  private chunks = new Map<string, DocumentChunkAssembler>();
  private requests = new Map<string, { kind: "standard" | "custom"; jobId: string }>();
  private delivered = new Set<string>();
  private cancellations = new CancellationTracker(state => this.update({ cancellations: state }));
  constructor(private runtime: typeof chrome.runtime = chrome.runtime) {}
  subscribe(listener: (event: GenerationEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: "state", state: this.state });
    this.connect();
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(event: GenerationEvent) {
    for (const listener of this.listeners) listener(event);
  }
  private update(next: Partial<GenerationState>) {
    this.state = { ...this.state, ...next };
    this.emit({ type: "state", state: this.state });
  }
  private connect(): HostStream {
    if (this.port) return this.port;
    const port = openHostStream(
      message => {
        if (message.type !== "generationState" && this.cancellations.receive(message)) return;
        if (message.type === "generationState") {
          const active = message.active;
          for (const run of [active, ...(message.queue ?? [])]) {
            if (run)
              this.requests.set(run.requestId, {
                kind: run.kind ?? run.summary?.kind ?? "standard",
                jobId: run.jobId,
              });
          }
          this.update({
            active,
            queue: message.queue,
            connection: message.connection,
            ...(active ? { lastJobId: active.jobId } : {}),
          });
          return;
        }
        if (message.id === this.preflight?.id) {
          const payload = this.preflight.payload;
          const confirmed = this.preflight.confirmed;
          this.preflight = null;
          this.update({ checking: false });
          if (message.type === "duplicates") {
            if (message.matches.length && !confirmed)
              this.update({
                duplicate: { payload, token: message.token, matches: message.matches },
              });
            else this.generate(payload, message.token, !!confirmed);
          } else if (message.type === "error") this.emit(message);
          return;
        }
        if (message.type === "backupsFinished") {
          this.emit(message);
          return;
        }
        if (
          message.id === this.awaitingAdmission &&
          (message.type === "job" || message.type === "error")
        ) {
          this.awaitingAdmission = null;
          this.update({ checking: false, submitting: false });
          if (
            message.type === "job" &&
            message.job.id === message.id &&
            (message.job.status === "queued" || message.job.status === "running")
          ) {
            this.emit({ type: "admitted", job: message.job });
          }
        }
        if (message.type === "job") {
          this.emit(message);
          return;
        }
        if (!this.requests.has(message.id)) return;
        if (
          message.type === "error" &&
          this.cancellations.wasCancelled(this.requests.get(message.id)!.jobId)
        )
          return;
        if (message.type === "result") this.deliver(message.id, message.document);
        else if (message.type === "documentChunk") {
          try {
            const assembler = this.chunks.get(message.id) ?? new DocumentChunkAssembler();
            this.chunks.set(message.id, assembler);
            const document = assembler.push(message);
            if (document) this.deliver(message.id, document);
            else if (message.index === message.total - 1)
              void this.recover(message.id, message.documentId);
          } catch {
            void this.recover(message.id, message.documentId);
          }
        } else if (message.type === "customChunk") {
          try {
            const assembler = this.customChunks.get(message.id) ?? new CustomChunkAssembler();
            this.customChunks.set(message.id, assembler);
            const document = assembler.push(message);
            if (document && "markdown" in document) this.deliverCustom(message.id, document);
            else if (message.index === message.total - 1)
              void this.recover(message.id, message.resourceId);
          } catch {
            void this.recover(message.id, message.resourceId);
          }
        } else this.emit(message);
      },
      error => {
        if (this.port !== port) return;
        this.port = null;
        this.cancellations.disconnect();
        const id = this.state.active?.requestId ?? this.preflight?.id;
        this.preflight = null;
        this.awaitingAdmission = null;
        this.requests.clear();
        this.chunks.clear();
        this.customChunks.clear();
        this.update({
          active: null,
          queue: [],
          checking: false,
          submitting: false,
          duplicate: null,
        });
        if (id)
          this.emit({
            type: "error",
            id,
            message: error.message,
          });
      },
      this.runtime,
    );
    this.port = port;
    port.send({ type: "watch" });
    port.send({ type: "resumeBackups", id: crypto.randomUUID() });
    return port;
  }
  private recovering = new Set<string>();
  private async recover(requestId: string, documentId: string) {
    const request = this.requests.get(requestId);
    if (!request || this.delivered.has(requestId) || this.recovering.has(requestId)) return;
    this.recovering.add(requestId);
    try {
      if (request.kind === "custom") {
        const document = await getCustomResource("document", documentId, this.runtime);
        if (this.requests.has(requestId)) this.deliverCustom(requestId, document);
      } else {
        const document = await getDocument(documentId, this.runtime);
        if (this.requests.has(requestId)) this.deliver(requestId, document);
      }
    } catch (error) {
      if (this.requests.has(requestId))
        this.emit({ id: requestId, type: "error", message: String(error) });
    } finally {
      this.recovering.delete(requestId);
    }
  }
  private deliver(id: string, document: LearningDocument) {
    if (this.delivered.has(id)) return;
    this.delivered.add(id);
    this.chunks.delete(id);
    this.customChunks.delete(id);
    this.emit({ type: "document", document });
  }
  private deliverCustom(id: string, document: CustomDocument) {
    if (this.delivered.has(id)) return;
    this.delivered.add(id);
    this.chunks.delete(id);
    this.customChunks.delete(id);
    this.emit({ type: "customDocument", document });
  }
  start(input: GenerationInput, confirmed = false) {
    if (this.state.checking) return;
    this.connect();
    this.invalidatePreflight();
    const payload = freezeRequest(
      isCustom(input)
        ? CustomGenerationRequestSchema.parse(structuredClone(input))
        : GenerationRequestSchema.parse(structuredClone(input)),
    );
    const id = crypto.randomUUID();
    this.preflight = { id, payload, confirmed };
    this.update({ checking: true, submitting: false, duplicate: null });
    this.connect().send(
      isCustom(payload)
        ? { id, type: "checkCustomDuplicates", payload }
        : { id, type: "checkDuplicates", payload },
    );
  }
  confirmRegeneration() {
    if (!this.state.duplicate) return;
    const { payload, token } = this.state.duplicate;
    this.generate(payload, token, true);
  }
  dismissDuplicate() {
    this.invalidatePreflight();
  }
  invalidatePreflight() {
    this.preflight = null;
    this.update({ checking: !!this.awaitingAdmission, duplicate: null });
  }
  private generate(payload: GenerationInput, token: string, confirm: boolean) {
    this.awaitingAdmission = payload.id;
    this.requests.set(payload.id, {
      kind: isCustom(payload) ? "custom" : "standard",
      jobId: payload.id,
    });
    this.update({
      duplicate: null,
      checking: true,
      submitting: true,
      active: this.state.active ?? {
        requestId: payload.id,
        jobId: payload.id,
        ...(isCustom(payload) ? { kind: "custom" as const } : {}),
      },
      lastJobId: payload.id,
    });
    this.connect().send(
      isCustom(payload)
        ? {
            id: payload.id,
            type: "generateCustom",
            payload,
            checkToken: token,
            confirmRegeneration: confirm,
          }
        : {
            id: payload.id,
            type: "generate",
            payload,
            checkToken: token,
            confirmRegeneration: confirm,
          },
    );
  }
  resume(jobId: string, kind: "standard" | "custom" = "standard") {
    if (this.state.checking) return;
    if (this.state.active?.jobId === jobId || this.state.queue?.some(run => run.jobId === jobId))
      return;
    this.connect();
    this.invalidatePreflight();
    const id = crypto.randomUUID();
    this.awaitingAdmission = id;
    this.requests.set(id, { kind, jobId });
    this.update({
      checking: true,
      submitting: true,
      active: this.state.active ?? { requestId: id, jobId, ...(kind === "custom" ? { kind } : {}) },
      lastJobId: jobId,
    });
    this.connect().send({ type: kind === "custom" ? "resumeCustom" : "resume", id, jobId });
  }
  cancelJob(jobId: string, kind: "standard" | "custom" = "standard") {
    const request = this.cancellations.request(jobId, kind);
    if (!request) return;
    try {
      this.connect().send(request);
    } catch {
      this.cancellations.unconfirmed(jobId);
    }
  }
  cancel() {
    if (this.state.active)
      this.cancelJob(
        this.state.active.jobId,
        this.state.active.kind ?? this.state.active.summary?.kind ?? "standard",
      );
  }
  resumeBackups() {
    this.connect().send({ type: "resumeBackups", id: crypto.randomUUID() });
  }
  dispose() {
    this.cancellations.dispose();
    const port = this.port;
    this.port = null;
    this.preflight = null;
    this.awaitingAdmission = null;
    this.requests.clear();
    this.chunks.clear();
    this.customChunks.clear();
    this.listeners.clear();
    port?.close();
  }
}
