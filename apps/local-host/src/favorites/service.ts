import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, link, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  captureFavorite,
  captureCustomFavorite,
  captureFavoriteCatalog,
  FavoriteCatalogOperationSchema,
  verifyFavoriteCatalogCoverage,
  favoriteIdentityBytes,
  favoriteCollectionBytes,
  favoriteText,
  FavoriteCollectionSchema,
  FavoriteConfigureSchema,
  FavoriteQuerySchema,
  FavoriteRecordSchema,
  FavoriteSetSchema,
  FAVORITE_MAX_BYTES,
  nextFavoriteVersion,
  parseFavoriteSnapshot,
  reduceFavorite,
  type FavoriteCollection,
  type FavoriteConfigure,
  type FavoriteRecord,
  type FavoritesService,
  type FavoriteSet,
  type FavoriteSummary,
  type FavoriteSyncStatus,
  type LearningDocument,
  type CustomDocument,
} from "@contextual/core";
import { documentRevision } from "../storage/document-queue";
import type { FavoriteCatalogDrive } from "../drive/favorites";

export type RemoteFavorite = {
  id: string;
  operationId: string;
  hash: string;
  schema: string;
  md5?: string;
};
export interface FavoriteDrive {
  list(accountId: string, collectionId: string): Promise<RemoteFavorite[]>;
  read(accountId: string, collectionId: string, file: RemoteFavorite): Promise<unknown>;
  reserve(accountId: string): Promise<string>;
  write(
    accountId: string,
    collectionId: string,
    record: FavoriteRecord,
    fileId: string,
  ): Promise<void>;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const favoriteKey = (origin: { documentId: string; sceneId: string }) =>
  hash(favoriteIdentityBytes(origin));
export const favoriteCollectionId = (collection: FavoriteCollection, namespace = "favorites-v1") =>
  collection.kind === "local"
    ? "local"
    : hash(favoriteCollectionBytes(collection.accountId, namespace));
export const favoriteBytes = (record: FavoriteRecord) => JSON.stringify(record);
const importMutationId = (collectionId: string, sourceId: string) => {
  const value = hash(collectionId + ":import:" + sourceId);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};
const uuid = z.string().uuid();
const receiptSchema = z
  .object({ id: z.string().min(1).max(256), hash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const configSchema = z
  .object({
    mutationId: uuid,
    accountId: z.string().min(1).max(256),
    enabled: z.boolean(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    createdAt: z.string().datetime(),
    requestHash: z.string(),
    imports: z.array(z.object({ sourceId: uuid, mutationId: uuid }).strict()),
  })
  .strict();
type Config = z.infer<typeof configSchema>;
const isMissing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const isExists = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "EEXIST";

async function readJSON(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
async function optionalJSON(path: string): Promise<unknown | undefined> {
  try {
    return await readJSON(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
async function commit(path: string, value: unknown): Promise<unknown> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + "." + randomUUID() + ".tmp";
  const file = await open(temp, "wx", 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    let committed = value;
    try {
      await link(temp, path);
    } catch (error) {
      if (isExists(error)) committed = await readJSON(path);
      else throw error;
    }
    if (process.platform !== "win32") {
      const directory = await open(dirname(path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return committed;
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

export function createFavoritesService(options: {
  root: string;
  loadDocument: (id: string) => Promise<LearningDocument | null>;
  loadCustomDocument?: (id: string) => Promise<CustomDocument | null>;
  drive: FavoriteDrive;
  catalog?: FavoriteCatalogDrive;
  namespace?: string;
}): FavoritesService {
  const writerId = randomUUID();
  const queues = new Map<string, Promise<unknown>>();
  const syncs = new Map<string, Promise<FavoriteSyncStatus>>();
  const syncRequested = new Set<string>();
  const statuses = new Map<string, FavoriteSyncStatus>();
  const cache = new Map<string, { signature: string; record?: FavoriteRecord; invalid: boolean }>();
  const collectionId = (collection: FavoriteCollection) =>
    favoriteCollectionId(collection, options.namespace);
  const folder = (collection: FavoriteCollection) =>
    join(
      options.root,
      collection.kind === "local" ? "local" : "accounts/" + collectionId(collection),
    );
  const operationPath = (collection: FavoriteCollection, id: string) =>
    join(folder(collection), "operations", uuid.parse(id) + ".json");
  function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(key, result);
    void result
      .finally(() => {
        if (queues.get(key) === result) queues.delete(key);
      })
      .catch(() => {});
    return result;
  }
  function parseRecord(raw: unknown, collection: FavoriteCollection): FavoriteRecord {
    const record = FavoriteRecordSchema.parse(raw);
    if (
      record.collectionId !== collectionId(collection) ||
      record.key !== favoriteKey(record.origin)
    )
      throw new Error("Favorite identity mismatch");
    if (record.action === "add") parseFavoriteSnapshot(record.snapshot);
    if (Buffer.byteLength(favoriteBytes(record)) > FAVORITE_MAX_BYTES)
      throw new Error("Favorite exceeds the 20 MB limit");
    return record;
  }
  async function inventory(collection: FavoriteCollection) {
    const path = join(folder(collection), "operations");
    await mkdir(path, { recursive: true, mode: 0o700 });
    const records: FavoriteRecord[] = [];
    let partial = false;
    for (const name of await readdir(path)) {
      if (name.endsWith(".tmp")) continue;
      if (!name.endsWith(".json") || !uuid.safeParse(name.slice(0, -5)).success) {
        partial = true;
        continue;
      }
      const filename = join(path, name);
      const info = await stat(filename);
      const signature = `${info.mtimeMs}:${info.size}`;
      let entry = cache.get(filename);
      if (!entry || entry.signature !== signature) {
        try {
          if (info.size > FAVORITE_MAX_BYTES) throw new Error("Favorite exceeds the 20 MB limit");
          const record = parseRecord(await readJSON(filename), collection);
          if (record.operationId !== name.slice(0, -5))
            throw new Error("Favorite filename mismatch");
          entry = { signature, record, invalid: false };
        } catch {
          entry = { signature, invalid: true };
        }
        cache.set(filename, entry);
      }
      partial ||= entry.invalid;
      if (entry.record) records.push(entry.record);
    }
    return { records, partial };
  }
  async function configuration(collection: FavoriteCollection): Promise<Config | undefined> {
    if (collection.kind === "local") return undefined;
    const path = join(folder(collection), "configurations");
    let names: string[];
    try {
      names = await readdir(path);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    const configurations = await Promise.all(
      names
        .filter(n => n.endsWith(".json"))
        .map(async name => configSchema.parse(await readJSON(join(path, name)))),
    );
    return configurations
      .sort(
        (a, b) =>
          a.sequence - b.sequence ||
          Number(!a.enabled) - Number(!b.enabled) ||
          a.mutationId.localeCompare(b.mutationId),
      )
      .at(-1);
  }
  async function acknowledged(collection: FavoriteCollection, record: FavoriteRecord) {
    try {
      const raw = await optionalJSON(
        join(folder(collection), "acks", record.operationId + ".json"),
      );
      return raw !== undefined && receiptSchema.parse(raw).hash === hash(favoriteBytes(record));
    } catch {
      return false;
    }
  }
  async function summary(
    collection: FavoriteCollection,
    record: Extract<FavoriteRecord, { action: "add" }>,
  ): Promise<FavoriteSummary> {
    const s = record.snapshot;
    const text = favoriteText(s);
    return {
      ...record.origin,
      kind: s.snapshotVersion === 2 ? "custom" : "scene",
      key: record.key,
      title: text.title,
      sourceTitle: s.source.title,
      language: text.language,
      excerpt: text.excerpt,
      savedAt: record.createdAt,
      pending: collection.kind === "account" && !(await acknowledged(collection, record)),
    };
  }
  async function status(collection: FavoriteCollection): Promise<FavoriteSyncStatus> {
    FavoriteCollectionSchema.parse(collection);
    const { records, partial } = await inventory(collection);
    const enabled = !!(await configuration(collection))?.enabled;
    const flags = await Promise.all(records.map(record => acknowledged(collection, record)));
    const pending = collection.kind === "local" ? 0 : flags.filter(flag => !flag).length;
    const previous = statuses.get(collectionId(collection));
    return {
      collection,
      enabled,
      pending,
      state: partial
        ? "partial"
        : collection.kind === "local"
          ? "local"
          : !enabled
            ? "disabled"
            : previous?.state === "syncing"
              ? "syncing"
              : pending
                ? previous?.state === "auth-required" ||
                  previous?.state === "offline" ||
                  previous?.state === "error" ||
                  previous?.state === "partial"
                  ? previous.state
                  : "pending"
                : (previous?.state ?? "pending"),
      ...(partial
        ? { issue: "Some favorite data cannot be read. Original files were preserved." }
        : previous?.issue
          ? { issue: previous.issue }
          : {}),
    };
  }
  async function set(request: FavoriteSet): Promise<FavoriteSummary | null> {
    const input = FavoriteSetSchema.parse(request);
    const key = favoriteKey(input);
    return serial(collectionId(input.collection) + ":" + key, async () => {
      const requestHash = hash(
        JSON.stringify([
          collectionId(input.collection),
          input.documentId,
          input.sceneId,
          input.desired,
        ]),
      );
      const { records, partial } = await inventory(input.collection);
      const existing = records.find(r => r.operationId === input.mutationId);
      const sameKey = records.filter(r => r.key === key);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new Error("Favorite mutation identity reused");
        const current = reduceFavorite(sameKey);
        return current ? summary(input.collection, current) : null;
      }
      if (partial) throw new Error("Some favorite history cannot be read; no data was replaced");
      const base = {
        schemaVersion: 1 as const,
        operationId: input.mutationId,
        collectionId: collectionId(input.collection),
        key,
        origin: { documentId: input.documentId, sceneId: input.sceneId },
        writerId,
        version: nextFavoriteVersion(sameKey, writerId),
        createdAt: new Date().toISOString(),
        requestHash,
      };
      let record: FavoriteRecord;
      if (input.desired) {
        const current = reduceFavorite(sameKey);
        const document = current ? null : await options.loadDocument(input.documentId);
        const customDocument =
          !current && !document && input.sceneId === input.documentId
            ? await options.loadCustomDocument?.(input.documentId)
            : null;
        const retained = [...sameKey]
          .filter((r): r is Extract<FavoriteRecord, { action: "add" }> => r.action === "add")
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) || b.operationId.localeCompare(a.operationId),
          )[0];
        const snapshot =
          current?.snapshot ??
          (document
            ? captureFavorite(document, input.sceneId, base.createdAt, documentRevision(document))
            : customDocument
              ? captureCustomFavorite(
                  customDocument,
                  base.createdAt,
                  hash(JSON.stringify(customDocument)),
                )
              : retained?.snapshot);
        if (!snapshot) throw new Error("Saved content not found");
        record = { ...base, action: "add", snapshot };
      } else record = { ...base, action: "remove" };
      record = parseRecord(record, input.collection);
      const committed = parseRecord(
        await commit(operationPath(input.collection, input.mutationId), record),
        input.collection,
      );
      if (committed.requestHash !== requestHash)
        throw new Error("Favorite mutation identity reused");
      statuses.delete(collectionId(input.collection));
      const current = reduceFavorite(
        (await inventory(input.collection)).records.filter(r => r.key === key),
      );
      return current ? summary(input.collection, current) : null;
    });
  }
  async function finishImport(collection: FavoriteCollection, config: Config): Promise<void> {
    if (!config.enabled || (await configuration(collection))?.mutationId !== config.mutationId)
      return;
    const local = await inventory({ kind: "local" });
    if (local.partial) throw new Error("Favorite import history is unreadable");
    for (const item of config.imports) {
      if ((await configuration(collection))?.mutationId !== config.mutationId) return;
      const source = local.records.find(r => r.operationId === item.sourceId);
      if (!source || source.action !== "add") throw new Error("Favorite import source missing");
      await serial(collectionId(collection) + ":" + source.key, async () => {
        const history = await inventory(collection);
        if (history.partial) throw new Error("Favorite history is unreadable");
        if (history.records.some(r => r.operationId === item.mutationId)) return;
        const origin = source.origin;
        const record = parseRecord(
          {
            ...source,
            collectionId: collectionId(collection),
            operationId: item.mutationId,
            writerId,
            version: nextFavoriteVersion(
              history.records.filter(r => r.key === source.key),
              writerId,
            ),
            createdAt: config.createdAt,
            requestHash: hash(
              JSON.stringify([collectionId(collection), origin.documentId, origin.sceneId, true]),
            ),
          },
          collection,
        );
        const saved = parseRecord(
          await commit(operationPath(collection, item.mutationId), record),
          collection,
        );
        if (saved.requestHash !== record.requestHash)
          throw new Error("Favorite import identity conflict");
      });
    }
  }
  async function configure(change: FavoriteConfigure): Promise<FavoriteSyncStatus> {
    const input = FavoriteConfigureSchema.parse(change);
    const collection: FavoriteCollection = { kind: "account", accountId: input.accountId };
    return serial(collectionId(collection) + ":config", async () => {
      const requestHash = hash(JSON.stringify(input));
      const path = join(folder(collection), "configurations", input.mutationId + ".json");
      const old = await optionalJSON(path);
      let config: Config;
      if (old !== undefined) config = configSchema.parse(old);
      else {
        const local = await inventory({ kind: "local" });
        if (input.kind === "enable" && input.importLocal && local.partial)
          throw new Error("Local favorites cannot be imported while some files are unreadable");
        const imports =
          input.kind === "enable" && input.importLocal
            ? [...new Set(local.records.map(r => r.key))].flatMap(key => {
                const winner = reduceFavorite(local.records.filter(r => r.key === key));
                return winner
                  ? [
                      {
                        sourceId: winner.operationId,
                        mutationId: importMutationId(collectionId(collection), winner.operationId),
                      },
                    ]
                  : [];
              })
            : [];
        const sequence = ((await configuration(collection))?.sequence ?? 0) + 1;
        config = configSchema.parse(
          await commit(
            path,
            configSchema.parse({
              mutationId: input.mutationId,
              accountId: input.accountId,
              enabled: input.kind === "enable",
              sequence,
              createdAt: new Date().toISOString(),
              requestHash,
              imports,
            }),
          ),
        );
      }
      if (config.requestHash !== requestHash)
        throw new Error("Favorite configuration identity reused");
      await finishImport(collection, config);
      statuses.delete(collectionId(collection));
      return status(collection);
    });
  }
  async function sync(collection: FavoriteCollection): Promise<FavoriteSyncStatus> {
    FavoriteCollectionSchema.parse(collection);
    const id = collectionId(collection);
    if (collection.kind === "local") return status(collection);
    const active = syncs.get(id);
    if (active) {
      syncRequested.add(id);
      return active;
    }
    const accountId = collection.accountId;
    const round = async () => {
      const config = await configuration(collection);
      if (!config?.enabled) return status(collection);
      statuses.set(id, { collection, enabled: true, pending: 0, state: "syncing" });
      const check = async () => {
        const latest = await configuration(collection);
        if (!latest?.enabled || latest.mutationId !== config.mutationId)
          throw new Error("Favorites synchronization configuration changed");
      };
      try {
        await finishImport(collection, config);
        const pull = async () => {
          await check();
          const remote = await options.drive.list(accountId, id);
          const local = await inventory(collection);
          if (local.partial) throw new Error("Some local favorite data is unreadable");
          const byId = new Map(local.records.map(r => [r.operationId, r]));
          for (const file of remote) {
            await check();
            if (file.schema !== "1")
              throw new Error("A newer favorite format requires a Host update");
            const known = byId.get(file.operationId);
            if (
              known &&
              (hash(favoriteBytes(known)) !== file.hash ||
                (file.md5 &&
                  createHash("md5").update(favoriteBytes(known)).digest("hex") !== file.md5))
            )
              throw new Error("Cloud favorite content conflict");
            const record =
              known && file.md5
                ? known
                : parseRecord(await options.drive.read(accountId, id, file), collection);
            if (
              record.operationId !== file.operationId ||
              hash(favoriteBytes(record)) !== file.hash
            )
              throw new Error("Cloud favorite identity or checksum mismatch");
            const saved = parseRecord(
              await commit(operationPath(collection, record.operationId), record),
              collection,
            );
            if (favoriteBytes(saved) !== favoriteBytes(record))
              throw new Error("Favorite operation content conflict");
            byId.set(record.operationId, record);
            await commit(join(folder(collection), "acks", record.operationId + ".json"), {
              id: file.id,
              hash: file.hash,
            });
          }
          return { remote, records: [...byId.values()] };
        };
        const { remote, records } = await pull();
        const remoteIds = new Set(remote.map(r => r.operationId));
        for (const record of records) {
          if (remoteIds.has(record.operationId)) continue;
          await check();
          const bodyHash = hash(favoriteBytes(record));
          const reservationPath = join(
            folder(collection),
            "reservations",
            record.operationId + ".json",
          );
          let reservation = await optionalJSON(reservationPath);
          if (reservation === undefined)
            reservation = await commit(reservationPath, {
              id: await options.drive.reserve(accountId),
              hash: bodyHash,
            });
          const reserved = receiptSchema.parse(reservation);
          if (reserved.hash !== bodyHash) throw new Error("Favorite upload reservation conflict");
          await check();
          await options.drive.write(accountId, id, record, reserved.id);
          await check();
          await commit(join(folder(collection), "acks", record.operationId + ".json"), reserved);
        }
        const final = await pull();
        await check();
        if (options.catalog) {
          const catalogDrive = options.catalog;
          const catalogFiles = await catalogDrive.list(accountId, id);
          const catalog = await Promise.all(
            catalogFiles.map(async file => {
              if (file.schema !== "1") throw new Error("Unsupported favorite catalog format");
              const item = FavoriteCatalogOperationSchema.parse(
                await catalogDrive.read(accountId, id, file),
              );
              if (item.operationId !== file.operationId || hash(JSON.stringify(item)) !== file.hash)
                throw new Error("Favorite catalog checksum mismatch");
              return item;
            }),
          );
          for (const source of final.remote) {
            await check();
            const record = final.records.find(r => r.operationId === source.operationId);
            if (!record) throw new Error("Favorite catalog source missing");
            const projected = captureFavoriteCatalog(record, { id: source.id, hash: source.hash });
            const existing = catalog.filter(c => c.operationId === record.operationId);
            if (existing.length) {
              if (existing.some(c => JSON.stringify(c) !== JSON.stringify(projected)))
                throw new Error("Favorite catalog content conflict");
              continue;
            }
            const receiptPath = join(
              folder(collection),
              "catalog-reservations",
              record.operationId + ".json",
            );
            let reservation = await optionalJSON(receiptPath);
            const contentHash = hash(JSON.stringify(projected));
            if (reservation === undefined)
              reservation = await commit(receiptPath, {
                id: await catalogDrive.reserve(accountId),
                hash: contentHash,
              });
            const reserved = receiptSchema.parse(reservation);
            if (reserved.hash !== contentHash)
              throw new Error("Favorite catalog reservation conflict");
            await catalogDrive.write(accountId, id, projected, reserved.id);
            catalog.push(projected);
          }
          verifyFavoriteCatalogCoverage(final.remote, catalog, id);
          await check();
        }
        const completeIds = new Set(final.remote.map(r => r.operationId));
        const pending = (await inventory(collection)).records.filter(
          r => !completeIds.has(r.operationId),
        ).length;
        const result: FavoriteSyncStatus = {
          collection,
          enabled: true,
          pending,
          state: pending ? "pending" : "synced",
        };
        statuses.set(id, result);
        return result;
      } catch (error) {
        statuses.delete(id);
        const current = await status(collection);
        if (!current.enabled) return current;
        const message = error instanceof Error ? error.message : "Favorites synchronization failed";
        const code = error instanceof Error && "status" in error ? error.status : undefined;
        const state =
          code === 401 || /Google.*(憑證|帳號|授權)|Keychain/.test(message)
            ? "auth-required"
            : /fetch failed|network|ETIMEDOUT|ECONNRESET|timeout/i.test(message)
              ? "offline"
              : /format|checksum|conflict|unreadable|incomplete/i.test(message)
                ? "partial"
                : "error";
        const result: FavoriteSyncStatus = { ...current, state, issue: message.slice(0, 1200) };
        statuses.set(id, result);
        return result;
      }
    };
    const run = (async () => {
      let result: FavoriteSyncStatus;
      do {
        syncRequested.delete(id);
        result = await round();
      } while (syncRequested.delete(id));
      return result;
    })();
    syncs.set(id, run);
    void run
      .finally(() => {
        if (syncs.get(id) === run) syncs.delete(id);
      })
      .catch(() => {});
    return run;
  }
  return {
    set,
    configure,
    status,
    sync,
    async states(collection, documentId, sceneIds) {
      FavoriteCollectionSchema.parse(collection);
      uuid.parse(documentId);
      sceneIds.forEach(id => uuid.parse(id));
      const { records, partial } = await inventory(collection);
      if (partial) throw new Error("Some favorite data cannot be read");
      return Object.fromEntries(
        sceneIds.map(sceneId => [
          sceneId,
          !!reduceFavorite(records.filter(r => r.key === favoriteKey({ documentId, sceneId }))),
        ]),
      );
    },
    async get(collection, key) {
      FavoriteCollectionSchema.parse(collection);
      z.string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(key);
      const { records } = await inventory(collection);
      const current = reduceFavorite(records.filter(r => r.key === key));
      if (!current) throw new Error("Favorite not found");
      return current.snapshot;
    },
    async list(collection, query) {
      FavoriteCollectionSchema.parse(collection);
      const input = FavoriteQuerySchema.parse(query);
      const { records, partial } = await inventory(collection);
      const revision = hash(
        records
          .map(r => r.operationId)
          .sort()
          .join(":"),
      );
      const filter = hash(JSON.stringify([input.search ?? "", input.language ?? ""]));
      let offset = 0;
      if (input.cursor) {
        const parsed = z
          .object({
            revision: z.string(),
            filter: z.string(),
            offset: z.number().int().nonnegative(),
          })
          .parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
        if (parsed.revision !== revision || parsed.filter !== filter)
          throw new Error("Favorite list changed. Refresh the list.");
        offset = parsed.offset;
      }
      const search = input.search?.trim().toLocaleLowerCase() ?? "";
      const winners = [...new Set(records.map(r => r.key))].flatMap(key => {
        const r = reduceFavorite(records.filter(r => r.key === key));
        return r ? [r] : [];
      });
      const selected = winners
        .filter(r => {
          const text = favoriteText(r.snapshot);
          return (
            (!input.language || input.language === "all" || text.language === input.language) &&
            (!search || text.search.toLocaleLowerCase().includes(search))
          );
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.key.localeCompare(b.key));
      const items = await Promise.all(
        selected.slice(offset, offset + input.limit).map(r => summary(collection, r)),
      );
      return {
        items,
        partial,
        ...(offset + input.limit < selected.length
          ? {
              nextCursor: Buffer.from(
                JSON.stringify({ revision, filter, offset: offset + input.limit }),
              ).toString("base64url"),
            }
          : {}),
      };
    },
  };
}
