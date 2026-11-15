import {
  FAVORITE_MAX_BYTES,
  parseFavoriteSnapshot,
  type FavoriteCollection,
  type FavoriteSnapshot,
  type HostMessage,
} from "@contextual/core";

export function sameFavoriteCollection(a: FavoriteCollection, b: FavoriteCollection): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === "local" || (b.kind === "account" && a.accountId === b.accountId))
  );
}

export class FavoriteChunkAssembler {
  private parts: (Uint8Array | undefined)[] = [];
  private count = 0;
  private bytes = 0;
  constructor(
    private collection: FavoriteCollection,
    private key: string,
  ) {}

  push(message: Extract<HostMessage, { type: "favoriteChunk" }>): FavoriteSnapshot | null {
    if (!sameFavoriteCollection(message.collection, this.collection) || message.key !== this.key)
      throw new Error("Favorite chunk identity mismatch");
    if (
      !Number.isInteger(message.total) ||
      message.total < 1 ||
      message.total > 80 ||
      !Number.isInteger(message.index) ||
      message.index < 0 ||
      message.index >= message.total
    )
      throw new Error("Invalid favorite chunk index");
    if (!this.parts.length) this.parts = Array.from({ length: message.total });
    if (this.parts.length !== message.total || this.parts[message.index])
      throw new Error("Invalid or duplicate favorite chunk");
    if (message.dataBase64.length > 349528) throw new Error("Favorite chunk exceeds limit");
    const part = Uint8Array.from(atob(message.dataBase64), char => char.charCodeAt(0));
    this.bytes += part.length;
    if (this.bytes > FAVORITE_MAX_BYTES) throw new Error("Favorite exceeds the 20 MB reader limit");
    this.parts[message.index] = part;
    if (++this.count !== message.total) return null;
    const full = new Uint8Array(this.bytes);
    let offset = 0;
    for (const bytes of this.parts) {
      if (!bytes) throw new Error("Missing favorite chunk");
      full.set(bytes, offset);
      offset += bytes.length;
    }
    return parseFavoriteSnapshot(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(full)),
    );
  }
}
