import {
  GenerationRequestSchema,
  CustomGenerationRequestSchema,
  type CustomGenerationRequest,
  type CustomDocument,
  type GenerationRequest,
  type HostMessage,
  type LearningDocument,
  type DuplicateMatch,
} from "@immersive/core";
import { getDocument, getCustomResource, openHostStream, type HostStream } from "./host-client";
import { CustomChunkAssembler } from "./custom-chunks";
import { DocumentChunkAssembler } from "./document-chunks";
import type { GenerationControllerState } from "./generation-controller";

export type GenerationInput = GenerationRequest | CustomGenerationRequest;
const isCustom = (input: GenerationInput): input is CustomGenerationRequest =>
  "kind" in input && input.kind === "custom";
export type GenerationState = {
  active: GenerationControllerState["active"];
  connection?: GenerationControllerState["connection"];
  lastJobId: string | null;
  checking: boolean;
  duplicate: { payload: GenerationInput; token: string; matches: DuplicateMatch[] } | null;
};
export type GenerationEvent =
  | { type: "state"; state: GenerationState }
  | { type: "document"; document: LearningDocument }
  | { type: "customDocument"; document: CustomDocument }
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
  private preflight: { id: string; payload: GenerationInput; confirmed?: boolean } | null = null;
  private customChunks = new CustomChunkAssembler();
  private chunks = new DocumentChunkAssembler();
  private delivered = new Set<string>();
  private deliveryRequestId: string | null = null;
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
        if (message.type === "generationState") {
          const active = message.active;
          if (active) this.deliveryRequestId = active.requestId;
          if (active?.requestId !== this.state.active?.requestId) {
            this.chunks = new DocumentChunkAssembler();
            this.customChunks = new CustomChunkAssembler();
          }
          this.update({
            active,
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
        if (message.id !== this.state.active?.requestId) return;
        if (message.type === "result") this.deliver(message.id, message.document);
        else if (message.type === "documentChunk") {
          try {
            const document = this.chunks.push(message);
            if (document) this.deliver(message.id, document);
            else if (message.index === message.total - 1) void this.recover(message.documentId);
          } catch {
            void this.recover(message.documentId);
          }
        } else if (message.type === "customChunk") {
          try {
            const document = this.customChunks.push(message);
            if (document && "markdown" in document) this.deliverCustom(message.id, document);
            else if (message.index === message.total - 1) void this.recover(message.resourceId);
          } catch {
            void this.recover(message.resourceId);
          }
        } else this.emit(message);
      },
      error => {
        if (this.port !== port) return;
        this.port = null;
        const id = this.state.active?.requestId ?? this.preflight?.id;
        this.preflight = null;
        this.deliveryRequestId = null;
        this.update({ active: null, checking: false, duplicate: null });
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
  private async recover(documentId: string) {
    const requestId = this.state.active?.requestId;
    if (!requestId || this.delivered.has(requestId) || this.recovering.has(requestId)) return;
    this.recovering.add(requestId);
    try {
      if (this.state.active?.kind === "custom" || this.state.active?.summary?.kind === "custom") {
        const document = await getCustomResource("document", documentId, this.runtime);
        if (this.deliveryRequestId === requestId) this.deliverCustom(requestId, document);
      } else {
        const document = await getDocument(documentId, this.runtime);
        if (this.deliveryRequestId === requestId) this.deliver(requestId, document);
      }
    } catch (error) {
      if (this.deliveryRequestId === requestId)
        this.emit({ id: requestId, type: "error", message: String(error) });
    } finally {
      this.recovering.delete(requestId);
    }
  }
  private deliver(id: string, document: LearningDocument) {
    if (this.delivered.has(id)) return;
    this.delivered.add(id);
    this.emit({ type: "document", document });
  }
  private deliverCustom(id: string, document: CustomDocument) {
    if (this.delivered.has(id)) return;
    this.delivered.add(id);
    this.emit({ type: "customDocument", document });
  }
  start(input: GenerationInput, confirmed = false) {
    if (this.state.active || this.state.checking) return;
    this.connect();
    this.deliveryRequestId = null;
    this.invalidatePreflight();
    const payload = freezeRequest(
      isCustom(input)
        ? CustomGenerationRequestSchema.parse(structuredClone(input))
        : GenerationRequestSchema.parse(structuredClone(input)),
    );
    const id = crypto.randomUUID();
    this.preflight = { id, payload, confirmed };
    this.update({ checking: true, duplicate: null });
    this.connect().send(
      isCustom(payload)
        ? { id, type: "checkCustomDuplicates", payload }
        : { id, type: "checkDuplicates", payload },
    );
  }
  confirmRegeneration() {
    if (!this.state.duplicate || this.state.active) return;
    const { payload, token } = this.state.duplicate;
    this.generate(payload, token, true);
  }
  dismissDuplicate() {
    this.invalidatePreflight();
  }
  invalidatePreflight() {
    this.preflight = null;
    this.update({ checking: false, duplicate: null });
  }
  private generate(payload: GenerationInput, token: string, confirm: boolean) {
    this.deliveryRequestId = payload.id;
    this.chunks = new DocumentChunkAssembler();
    this.customChunks = new CustomChunkAssembler();
    this.update({
      duplicate: null,
      active: {
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
    if (this.state.active) return;
    this.connect();
    this.invalidatePreflight();
    const id = crypto.randomUUID();
    this.deliveryRequestId = id;
    this.chunks = new DocumentChunkAssembler();
    this.customChunks = new CustomChunkAssembler();
    this.update({
      active: { requestId: id, jobId, ...(kind === "custom" ? { kind } : {}) },
      lastJobId: jobId,
    });
    this.connect().send({ type: kind === "custom" ? "resumeCustom" : "resume", id, jobId });
  }
  cancel() {
    if (this.state.active)
      this.connect().send({
        type:
          this.state.active.kind === "custom" || this.state.active.summary?.kind === "custom"
            ? "cancelCustom"
            : "cancel",
        id: crypto.randomUUID(),
        jobId: this.state.active.jobId,
      });
  }
  resumeBackups() {
    this.connect().send({ type: "resumeBackups", id: crypto.randomUUID() });
  }
  dispose() {
    const port = this.port;
    this.port = null;
    this.preflight = null;
    this.deliveryRequestId = null;
    this.listeners.clear();
    port?.close();
  }
}
