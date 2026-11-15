import {
  FavoriteCollectionSchema,
  FavoriteSetSchema,
  FavoriteConfigureSchema,
  type FavoriteCollection,
  type FavoriteConfigure,
  type FavoritePage,
  type FavoriteQuery,
  type FavoriteSet,
  type FavoriteSyncStatus,
  type HostMessage,
} from "@contextual/core";
import { request, openHostStream } from "../native/host-client";
import { sameFavoriteCollection } from "../native/favorite-chunks";
import type { PreferencesStorage } from "./preferences-store";

const VIEW_KEY = "favoriteCollectionV1";
const RETRY_KEY = "favoriteRetriesV1";
type Retry = { kind: "set"; input: FavoriteSet } | { kind: "configure"; change: FavoriteConfigure };
export type FavoritesState = {
  collection: FavoriteCollection;
  states: Readonly<Record<string, boolean>>;
  pending: ReadonlySet<string>;
  page: FavoritePage | null;
  status: FavoriteSyncStatus | null;
  loading: boolean;
  error: "load" | "save" | "sync" | "storage" | null;
};
export const favoriteStateKey = (documentId: string, sceneId: string) => documentId + ":" + sceneId;
export class FavoritesStore {
  private value: FavoritesState = {
    collection: { kind: "local" },
    states: {},
    pending: new Set(),
    page: null,
    status: null,
    loading: false,
    error: null,
  };
  private listeners = new Set<() => void>();
  private retries: Retry[] = [];
  private writes = Promise.resolve();
  private tracked = new Map<string, string[]>();
  private query: FavoriteQuery = { limit: 40 };
  private listing = false;
  private listRevision = 0;
  private statesRevision = 0;
  private statusRevision = 0;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private loading?: Promise<void>;
  constructor(
    private storage: PreferencesStorage,
    private send = request,
  ) {}
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<FavoritesState>) {
    this.value = { ...this.value, ...change };
    for (const listener of this.listeners) listener();
  }
  private current(collection: FavoriteCollection) {
    return sameFavoriteCollection(collection, this.value.collection);
  }
  private persistRetries() {
    const retries = [...this.retries];
    const write = this.writes
      .catch(() => {})
      .then(() => this.storage.set({ [RETRY_KEY]: retries }));
    this.writes = write;
    return write;
  }
  load() {
    return (this.loading ??= this.storage
      .get([VIEW_KEY, RETRY_KEY])
      .then(saved => {
        const collection = FavoriteCollectionSchema.safeParse(saved[VIEW_KEY]);
        if (collection.success) this.update({ collection: collection.data });
        if (Array.isArray(saved[RETRY_KEY]))
          for (const raw of saved[RETRY_KEY]) {
            if (!raw || typeof raw !== "object") continue;
            if ("input" in raw) {
              const parsed = FavoriteSetSchema.safeParse(raw.input);
              if (parsed.success) this.retries.push({ kind: "set", input: parsed.data });
            }
            if ("change" in raw) {
              const parsed = FavoriteConfigureSchema.safeParse(raw.change);
              if (parsed.success) this.retries.push({ kind: "configure", change: parsed.data });
            }
          }
      })
      .catch(() => {
        this.update({ error: "storage" });
      }));
  }
  async select(collection: FavoriteCollection) {
    await this.load();
    await this.storage.set({ [VIEW_KEY]: collection });
    this.listRevision++;
    this.statesRevision++;
    this.statusRevision++;
    this.update({
      collection,
      states: {},
      pending: new Set(),
      page: null,
      status: null,
      error: null,
    });
    await Promise.all([
      this.refreshStates(),
      this.refreshStatus(),
      ...(this.listing ? [this.list()] : []),
    ]);
    this.scheduleSync();
  }
  async track(documentId: string, sceneIds: string[]) {
    this.tracked.set(documentId, sceneIds);
    await this.load();
    await this.refreshStates();
  }
  untrack(documentId: string) {
    this.tracked.delete(documentId);
  }
  async refreshStates() {
    const collection = this.value.collection;
    const revision = ++this.statesRevision;
    for (const [documentId, ids] of this.tracked)
      for (let i = 0; i < ids.length; i += 100) {
        try {
          const reply = await this.send({
            type: "favoriteStates",
            collection,
            documentId,
            sceneIds: ids.slice(i, i + 100),
          });
          if (
            this.current(collection) &&
            revision === this.statesRevision &&
            sameFavoriteCollection(reply.collection, collection)
          )
            this.update({
              states: {
                ...this.value.states,
                ...Object.fromEntries(
                  Object.entries(reply.states)
                    .map(([id, value]) => [favoriteStateKey(documentId, id), value])
                    .filter(([key]) => typeof key === "string" && !this.value.pending.has(key)),
                ),
              },
            });
        } catch {
          if (this.current(collection) && revision === this.statesRevision)
            this.update({ error: "load" });
        }
      }
  }
  async set(documentId: string, sceneId: string, desired: boolean) {
    await this.load();
    const collection = this.value.collection;
    const key = favoriteStateKey(documentId, sceneId);
    if (this.value.pending.has(key)) return;
    this.update({ pending: new Set([...this.value.pending, key]), error: null });
    let retry = this.retries.find(
      (r): r is Extract<Retry, { kind: "set" }> =>
        r.kind === "set" &&
        sameFavoriteCollection(r.input.collection, collection) &&
        r.input.documentId === documentId &&
        r.input.sceneId === sceneId &&
        r.input.desired === desired,
    );
    if (!retry) {
      retry = {
        kind: "set",
        input: { collection, documentId, sceneId, desired, mutationId: crypto.randomUUID() },
      };
      this.retries.push(retry);
    }
    try {
      await this.persistRetries();
      const reply = await this.send({ type: "setFavorite", input: retry.input });
      if (
        !sameFavoriteCollection(reply.collection, collection) ||
        (reply.favorite &&
          (reply.favorite.documentId !== documentId || reply.favorite.sceneId !== sceneId))
      )
        throw new Error("Favorite confirmation identity mismatch");
      this.retries = this.retries.filter(
        item =>
          item.kind !== "set" ||
          !sameFavoriteCollection(item.input.collection, collection) ||
          item.input.documentId !== documentId ||
          item.input.sceneId !== sceneId,
      );
      await this.persistRetries().catch(() => {});
      if (this.current(collection)) {
        this.statesRevision++;
        this.update({ states: { ...this.value.states, [key]: reply.favorite !== null } });
        if (this.listing) void this.list();
        this.scheduleSync();
      }
      return reply.favorite !== null;
    } catch (error) {
      if (this.current(collection)) this.update({ error: "save" });
      throw error;
    } finally {
      if (this.current(collection))
        this.update({ pending: new Set([...this.value.pending].filter(item => item !== key)) });
    }
  }
  async list(query: FavoriteQuery = this.query, append = false) {
    const collection = this.value.collection;
    const revision = ++this.listRevision;
    this.query = { ...query, cursor: undefined };
    this.update({ loading: true, error: null });
    try {
      const reply = await this.send({ type: "listFavorites", collection, query });
      if (!sameFavoriteCollection(reply.collection, collection))
        throw new Error("Favorite collection mismatch");
      if (this.current(collection) && revision === this.listRevision)
        this.update({
          page: {
            ...reply.page,
            items: append
              ? [...(this.value.page?.items ?? []), ...reply.page.items]
              : reply.page.items,
          },
        });
    } catch {
      if (this.current(collection) && revision === this.listRevision)
        this.update({ error: "load" });
    } finally {
      if (this.current(collection) && revision === this.listRevision)
        this.update({ loading: false });
    }
  }
  async refreshStatus() {
    const collection = this.value.collection;
    const revision = ++this.statusRevision;
    try {
      const reply = await this.send({ type: "favoriteStatus", collection });
      if (!sameFavoriteCollection(reply.status.collection, collection))
        throw new Error("Favorite collection mismatch");
      if (this.current(collection) && revision === this.statusRevision)
        this.update({ status: reply.status });
    } catch {
      if (this.current(collection) && revision === this.statusRevision)
        this.update({ error: "load" });
    }
  }
  async configure(
    change:
      | Omit<Extract<FavoriteConfigure, { kind: "enable" }>, "mutationId">
      | Omit<Extract<FavoriteConfigure, { kind: "disable" }>, "mutationId">,
  ) {
    await this.load();
    let retry = this.retries.find(
      (r): r is Extract<Retry, { kind: "configure" }> =>
        r.kind === "configure" &&
        r.change.kind === change.kind &&
        r.change.accountId === change.accountId,
    );
    if (!retry) {
      retry = { kind: "configure", change: { ...change, mutationId: crypto.randomUUID() } };
      this.retries.push(retry);
    }
    try {
      await this.persistRetries();
      const reply = await this.send({ type: "configureFavorites", change: retry.change });
      if (
        reply.status.collection.kind !== "account" ||
        reply.status.collection.accountId !== change.accountId
      )
        throw new Error("Favorite configuration identity mismatch");
      this.retries = this.retries.filter(
        item => item.kind !== "configure" || item.change.accountId !== change.accountId,
      );
      await this.persistRetries().catch(() => {});
      this.statusRevision++;
      if (
        change.kind === "enable" &&
        reply.status.enabled &&
        !this.current(reply.status.collection)
      ) {
        await this.select({ kind: "account", accountId: change.accountId });
      } else if (this.current(reply.status.collection)) {
        this.update({ status: reply.status, error: null });
        this.scheduleSync();
      }
    } catch (error) {
      this.update({ error: "save" });
      throw error;
    }
  }
  async sync() {
    const collection = this.value.collection;
    if (collection.kind === "local" || !this.value.status?.enabled) return;
    const status = this.value.status;
    const revision = ++this.statusRevision;
    this.update({ status: { ...this.value.status, state: "syncing" } });
    try {
      const reply = await this.send({ type: "syncFavorites", collection });
      if (!sameFavoriteCollection(reply.status.collection, collection))
        throw new Error("Favorite collection mismatch");
      if (this.current(collection) && revision === this.statusRevision) {
        this.update({ status: reply.status });
        await this.refreshStates();
        if (this.listing) await this.list();
      }
    } catch {
      if (this.current(collection) && revision === this.statusRevision)
        this.update({ error: "sync", status: { ...status, state: "error" } });
    }
  }
  private scheduleSync() {
    clearTimeout(this.syncTimer);
    if (this.value.status?.enabled)
      this.syncTimer = setTimeout(() => {
        void this.sync();
      }, 600);
  }
  async open() {
    this.listing = true;
    await this.load();
    await Promise.all([this.list(), this.refreshStatus()]);
    this.scheduleSync();
  }
  close() {
    this.listing = false;
  }
  receive(message: HostMessage) {
    if (message.type === "favoriteChanged" && this.current(message.collection)) {
      void this.refreshStates();
      if (this.listing) void this.list();
    }
  }
  connect() {
    let recovering = false;
    const stream = openHostStream(
      message => {
        if (message.type === "generationState") {
          const status = message.connection?.status;
          if (status === "reconnecting" || status === "failed") recovering = true;
          if (status === "ready" && recovering) {
            recovering = false;
            void this.refreshStatus().then(() => this.scheduleSync());
          }
        } else this.receive(message);
      },
      () => {
        this.update({ error: "load" });
      },
    );
    stream.send({ type: "watch" });
    void this.load()
      .then(() => this.refreshStatus())
      .then(() => this.scheduleSync());
    return () => {
      stream.close();
      clearTimeout(this.syncTimer);
    };
  }
}
let store: FavoritesStore | undefined;
export function getFavoritesStore() {
  return (store ??= new FavoritesStore({
    get: keys => chrome.storage.local.get(keys),
    set: values => chrome.storage.local.set(values),
  }));
}
