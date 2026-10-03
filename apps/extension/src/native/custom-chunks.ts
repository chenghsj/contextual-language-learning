import {
  CustomDocumentSchema,
  CustomJobSnapshotSchema,
  type CustomDocument,
  type CustomJobSnapshot,
  type HostMessage,
} from "@immersive/core";
export class CustomChunkAssembler {
  private identity: string | undefined;
  private resource: "document" | "job" | undefined;
  private parts: (Uint8Array | undefined)[] = [];
  private bytes = 0;
  private count = 0;
  push(
    message: Extract<HostMessage, { type: "customChunk" }>,
  ): CustomDocument | CustomJobSnapshot | null {
    if (
      message.total < 1 ||
      message.total > 100 ||
      message.index < 0 ||
      message.index >= message.total
    )
      throw new Error("Invalid custom chunk index");
    if (!this.identity) {
      this.identity = message.resourceId;
      this.resource = message.resource;
      this.parts = Array.from({ length: message.total });
    }
    if (
      message.resourceId !== this.identity ||
      message.resource !== this.resource ||
      message.total !== this.parts.length ||
      this.parts[message.index]
    )
      throw new Error("Custom chunks have duplicate or mismatched identity");
    const binary = atob(message.dataBase64),
      part = Uint8Array.from(binary, char => char.charCodeAt(0));
    this.bytes += part.length;
    if (this.bytes > 20 * 1024 * 1024) throw new Error("Custom result exceeds 20 MB");
    this.parts[message.index] = part;
    this.count++;
    if (this.count !== this.parts.length) return null;
    const bytes = new Uint8Array(this.bytes);
    let offset = 0;
    for (const part of this.parts) {
      bytes.set(part!, offset);
      offset += part!.length;
    }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const result =
      this.resource === "document"
        ? CustomDocumentSchema.parse(raw)
        : CustomJobSnapshotSchema.parse(raw);
    if (("id" in result ? result.id : result.summary.id) !== this.identity)
      throw new Error("Custom result identity mismatch");
    return result;
  }
}
