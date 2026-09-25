import { LearningDocumentSchema, type HostMessage, type LearningDocument } from "@immersive/core";

type ChunkMessage = Extract<HostMessage, { type: "documentChunk" }>;

/** Reassembles bounded Host messages into a schema-checked UTF-8 document. */
export class DocumentChunkAssembler {
  private documentId: string | null = null;
  private parts: (Uint8Array | undefined)[] = [];
  private count = 0;
  private totalBytes = 0;

  push(message: ChunkMessage): LearningDocument | null {
    if (!Number.isInteger(message.total) || message.total < 1 || message.total > 1000 ||
      !Number.isInteger(message.index) || message.index < 0 || message.index >= message.total) {
      throw new Error("Invalid document chunk index");
    }
    if (this.documentId === null) {
      this.documentId = message.documentId;
      this.parts = Array.from({ length: message.total });
    }
    if (this.documentId !== message.documentId || this.parts.length !== message.total) {
      throw new Error("Document chunks belong to different documents");
    }
    if (this.parts[message.index] !== undefined) throw new Error("Duplicate document chunk");
    const binary = atob(message.dataBase64);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    this.totalBytes += bytes.length;
    if (this.totalBytes > 20 * 1024 * 1024) throw new Error("Document exceeds the 20 MB reader limit");
    this.parts[message.index] = bytes;
    this.count += 1;
    if (this.count !== this.parts.length) return null;
    const full = new Uint8Array(this.totalBytes);
    let offset = 0;
    for (const part of this.parts) {
      if (!part) throw new Error("Missing document chunk");
      full.set(part, offset);
      offset += part.length;
    }
    const document = LearningDocumentSchema.parse(JSON.parse(new TextDecoder().decode(full)) as unknown);
    if (document.id !== this.documentId) throw new Error("Document chunk identity mismatch");
    return document;
  }
}
