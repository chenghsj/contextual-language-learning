import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  FAVORITE_MAX_BYTES,
  FAVORITE_CATALOG_MAX_BYTES,
  FAVORITE_CATALOG_KIND,
  type FavoriteCatalogOperation,
  type FavoriteRecord,
} from "@contextual/core";
import { appFolder, googleFetch, DriveRequestError, validateDriveAppProperties } from "./api";
import { type FavoriteDrive, type RemoteFavorite } from "../favorites/service";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
async function favoriteFolder(accountId: string, leaf = "operations"): Promise<string> {
  let parent = await appFolder(accountId);
  for (const name of ["Favorites", leaf]) {
    const url = new URL(API + "/files");
    url.searchParams.set(
      "q",
      `trashed = false and '${parent}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${name}'`,
    );
    url.searchParams.set("fields", "files(id)");
    const found = z
      .object({ files: z.array(z.object({ id: z.string() })).default([]) })
      .parse(await (await googleFetch(accountId, url.toString())).json());
    if (found.files[0]) parent = found.files[0].id;
    else
      parent = z.object({ id: z.string() }).parse(
        await (
          await googleFetch(accountId, API + "/files?fields=id", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              mimeType: "application/vnd.google-apps.folder",
              parents: [parent],
            }),
          })
        ).json(),
      ).id;
  }
  return parent;
}
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const fileSchema = z.object({
  id: z.string().min(1).max(256),
  appProperties: z.record(z.string()).default({}),
  md5Checksum: z.string().optional(),
  trashed: z.boolean().optional(),
});
const pageSchema = z.object({
  files: z.array(fileSchema).default([]),
  nextPageToken: z.string().optional(),
  incompleteSearch: z.boolean().optional(),
});
const metadata = (collectionId: string, record: { operationId: string }, kind: string) => ({
  contextualKind: kind,
  contextualFavoriteCollection: collectionId,
  contextualFavoriteOperation: record.operationId,
  contextualFavoriteSchema: "1",
  contextualContentHash: hash(JSON.stringify(record)),
});
const parseFile = (input: unknown, collectionId: string, kind: string): RemoteFavorite => {
  const file = fileSchema.parse(input),
    p = file.appProperties;
  if (file.trashed || p.contextualKind !== kind || p.contextualFavoriteCollection !== collectionId)
    throw new Error("Cloud favorite ownership mismatch");
  return {
    id: file.id,
    operationId: z.string().uuid().parse(p.contextualFavoriteOperation),
    hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(p.contextualContentHash),
    schema: p.contextualFavoriteSchema ?? "unknown",
    ...(file.md5Checksum ? { md5: file.md5Checksum } : {}),
  };
};
async function boundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes)
    throw new Error("Cloud favorite exceeds the 20 MB limit");
  if (!response.body) throw new Error("Cloud favorite has no content");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.length;
      if (total > maxBytes) throw new Error("Cloud favorite exceeds the 20 MB limit");
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, total);
}
type DrivePorts = { fetch: typeof googleFetch; folder: typeof appFolder };
export interface FavoriteCatalogDrive {
  list(accountId: string, collectionId: string): Promise<RemoteFavorite[]>;
  read(accountId: string, collectionId: string, file: RemoteFavorite): Promise<unknown>;
  reserve(accountId: string): Promise<string>;
  write(
    accountId: string,
    collectionId: string,
    record: FavoriteCatalogOperation,
    fileId: string,
  ): Promise<void>;
}
export function createFavoriteDrive(
  ports: DrivePorts = { fetch: googleFetch, folder: favoriteFolder },
): FavoriteDrive {
  return createOperationDrive<FavoriteRecord>(ports, "favorite-operation", FAVORITE_MAX_BYTES);
}
export function createFavoriteCatalogDrive(
  ports: DrivePorts = { fetch: googleFetch, folder: id => favoriteFolder(id, "catalog") },
): FavoriteCatalogDrive {
  return createOperationDrive<FavoriteCatalogOperation>(
    ports,
    FAVORITE_CATALOG_KIND,
    FAVORITE_CATALOG_MAX_BYTES,
  );
}
function createOperationDrive<T extends { operationId: string }>(
  ports: DrivePorts,
  kind: string,
  maxBytes: number,
) {
  return {
    async list(accountId: string, collectionId: string) {
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(collectionId);
      const result: RemoteFavorite[] = [];
      const tokens = new Set<string>();
      let token: string | undefined;
      do {
        const url = new URL(API + "/files");
        url.searchParams.set(
          "q",
          `trashed = false and appProperties has { key='contextualKind' and value='${kind}' } and appProperties has { key='contextualFavoriteCollection' and value='${collectionId}' }`,
        );
        url.searchParams.set(
          "fields",
          "nextPageToken,incompleteSearch,files(id,appProperties,md5Checksum,trashed)",
        );
        url.searchParams.set("pageSize", "1000");
        if (token) url.searchParams.set("pageToken", token);
        const page = pageSchema.parse(await (await ports.fetch(accountId, url.toString())).json());
        if (page.incompleteSearch)
          throw new Error("Google Drive returned an incomplete favorite listing");
        for (const file of page.files) result.push(parseFile(file, collectionId, kind));
        token = page.nextPageToken;
        if (token) {
          if (tokens.has(token)) throw new Error("Google Drive repeated a favorite page token");
          tokens.add(token);
        }
      } while (token);
      return result;
    },
    async read(accountId: string, collectionId: string, file: RemoteFavorite) {
      const remote = parseFile(
        await (
          await ports.fetch(
            accountId,
            API +
              "/files/" +
              encodeURIComponent(file.id) +
              "?fields=id,appProperties,md5Checksum,trashed",
          )
        ).json(),
        collectionId,
        kind,
      );
      if (
        remote.operationId !== file.operationId ||
        remote.hash !== file.hash ||
        remote.schema !== file.schema
      )
        throw new Error("Cloud favorite metadata changed");
      const bytes = await boundedBody(
        await ports.fetch(accountId, API + "/files/" + encodeURIComponent(file.id) + "?alt=media"),
        maxBytes,
      );
      if (hash(bytes) !== file.hash) throw new Error("Cloud favorite checksum mismatch");
      return JSON.parse(bytes.toString("utf8"));
    },
    async reserve(accountId: string) {
      const data = z
        .object({ ids: z.array(z.string().min(1).max(256)).min(1) })
        .parse(
          await (
            await ports.fetch(accountId, API + "/files/generateIds?count=1&space=drive&type=files")
          ).json(),
        );
      return data.ids[0];
    },
    async write(accountId: string, collectionId: string, record: T, fileId: string) {
      const properties = metadata(collectionId, record, kind);
      validateDriveAppProperties(properties);
      const text = JSON.stringify(record);
      if (Buffer.byteLength(text) > maxBytes) throw new Error("Favorite exceeds the 20 MB limit");
      const boundary = "favorite_" + randomBytes(12).toString("hex");
      const folder = await ports.folder(accountId);
      const body = Buffer.from(
        "--" +
          boundary +
          "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
          JSON.stringify({
            id: fileId,
            name: record.operationId + ".favorite.json",
            mimeType: "application/json",
            parents: [folder],
            appProperties: properties,
          }) +
          "\r\n--" +
          boundary +
          "\r\nContent-Type: application/json\r\n\r\n" +
          text +
          "\r\n--" +
          boundary +
          "--\r\n",
      );
      try {
        if (Buffer.byteLength(text) > 5_000_000) {
          const start = await ports.fetch(
            accountId,
            UPLOAD + "/files?uploadType=resumable&fields=id",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Upload-Content-Type": "application/json",
                "X-Upload-Content-Length": String(Buffer.byteLength(text)),
              },
              body: JSON.stringify({
                id: fileId,
                name: record.operationId + ".favorite.json",
                mimeType: "application/json",
                parents: [folder],
                appProperties: properties,
              }),
            },
          );
          const location = start.headers.get("location");
          if (!location) throw new Error("Google Drive did not return an upload session");
          const url = new URL(location);
          if (url.protocol !== "https:" || !url.hostname.endsWith(".googleapis.com"))
            throw new Error("Unexpected Google Drive upload endpoint");
          await ports.fetch(accountId, url.toString(), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: text,
          });
        } else
          await ports.fetch(accountId, UPLOAD + "/files?uploadType=multipart&fields=id", {
            method: "POST",
            headers: { "Content-Type": "multipart/related; boundary=" + boundary },
            body: new Uint8Array(body),
          });
      } catch (error) {
        if (!(error instanceof DriveRequestError) || error.status !== 409) throw error;
      }
      const expected: RemoteFavorite = {
        id: fileId,
        operationId: record.operationId,
        hash: properties.contextualContentHash,
        schema: "1",
      };
      const actual = await this.read(accountId, collectionId, expected);
      if (JSON.stringify(actual) !== text)
        throw new Error("Cloud favorite upload content conflict");
    },
  };
}
