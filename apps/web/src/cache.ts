import type { PendingFavorite } from "./favorite-writer";
import type { FavoriteCatalogOperation, FavoriteSnapshot } from "@contextual/core";
import type { LibraryCache, LibraryCatalog, LibraryDocument } from "./library";
export type CachedCatalog = { records: FavoriteCatalogOperation[]; updatedAt: string };
export interface FavoriteCache {
  catalog(account: string): Promise<CachedCatalog | undefined>;
  saveCatalog(account: string, value: CachedCatalog, valid: () => boolean): Promise<void>;
  content(account: string, hash: string): Promise<FavoriteSnapshot | undefined>;
  saveContent(
    account: string,
    hash: string,
    snapshot: FavoriteSnapshot,
    valid: () => boolean,
  ): Promise<void>;
  clear(account: string): Promise<void>;
}
export interface FavoriteMutationCache {
  pendingFavorites(account: string): Promise<PendingFavorite[]>;
  savePendingFavorite(account: string, value: PendingFavorite, valid: () => boolean): Promise<void>;
  removePendingFavorite(account: string, id: string): Promise<void>;
}
type Content = {
  account: string;
  hash: string;
  snapshot: unknown;
  size: number;
  touched: number;
};
export function createFavoriteCache(): FavoriteCache & LibraryCache & FavoriteMutationCache {
  let database: Promise<IDBDatabase> | undefined;
  function open() {
    return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cll-favorite-reader", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("catalog");
        request.result.createObjectStore("content");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        database = undefined;
        reject(new Error("請關閉其他收藏分頁後重試。"));
      };
    }));
  }
  async function get<T>(store: string, key: string): Promise<T | undefined> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly"),
        request = tx.objectStore(store).get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  async function saveContent(
    account: string,
    hash: string,
    snapshot: unknown,
    valid: () => boolean,
  ) {
    const estimate = await navigator.storage?.estimate().catch(() => undefined);
    const budget = Math.min(
      100 * 1024 * 1024,
      estimate?.quota === undefined ? Infinity : Math.floor(estimate.quota * 0.1),
    );
    const row: Content = {
      account,
      hash,
      snapshot,
      touched: Date.now(),
      size: new TextEncoder().encode(JSON.stringify(snapshot)).length,
    };
    if (row.size > budget) throw new Error("此教材可連線閱讀，但無足夠空間保存離線副本。");
    const db = await open();
    if (!valid()) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("content", "readwrite"),
        store = tx.objectStore("content");
      store.put(row, account + ":" + hash);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = (request.result as Content[])
          .filter(r => r.account === account)
          .sort((a, b) => b.touched - a.touched);
        let total = 0;
        rows.forEach((r, index) => {
          total += r.size;
          if (index >= 20 || total > budget) store.delete(account + ":" + r.hash);
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  return {
    async pendingFavorites(account) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const rows: PendingFavorite[] = [];
        const tx = db.transaction("catalog", "readonly");
        const request = tx.objectStore("catalog").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (String(cursor.key).startsWith(account + ":mutation:")) rows.push(cursor.value);
          cursor.continue();
        };
        tx.oncomplete = () => resolve(rows);
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    async savePendingFavorite(account, value, valid) {
      const db = await open();
      if (!valid()) return;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("catalog", "readwrite");
        tx.objectStore("catalog").put(value, account + ":mutation:" + value.record.operationId);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    async removePendingFavorite(account, id) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("catalog", "readwrite");
        tx.objectStore("catalog").delete(account + ":mutation:" + id);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    async libraryDocumentKeys(account) {
      const db = await open();
      const prefix = account + ":library:";
      return new Promise<string[]>((resolve, reject) => {
        const tx = db.transaction("content", "readonly");
        const request = tx
          .objectStore("content")
          .getAllKeys(IDBKeyRange.bound(prefix, prefix + "\uffff"));
        tx.oncomplete = () => resolve(request.result.map(key => String(key).slice(prefix.length)));
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    libraryCatalog: account => get<LibraryCatalog>("catalog", account + ":library"),
    async saveLibraryCatalog(account, value, valid) {
      const db = await open();
      if (!valid()) return;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("catalog", "readwrite");
        tx.objectStore("catalog").put(value, account + ":library");
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    async libraryDocument(account, key) {
      return (
        await get<Content & { snapshot: LibraryDocument }>("content", account + ":library:" + key)
      )?.snapshot;
    },
    saveLibraryDocument: (account, key, value, valid) =>
      saveContent(account, "library:" + key, value, valid),
    catalog: account => get<CachedCatalog>("catalog", account),
    async saveCatalog(account, value, valid) {
      const db = await open();
      if (!valid()) return;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("catalog", "readwrite");
        tx.objectStore("catalog").put(value, account);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
    async content(account, hash) {
      const value = await get<Content & { snapshot: FavoriteSnapshot }>(
        "content",
        account + ":" + hash,
      );
      return value?.snapshot;
    },
    saveContent,
    async clear(account) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["catalog", "content"], "readwrite");
        tx.objectStore("catalog").delete(account);
        tx.objectStore("catalog").delete(account + ":library");
        const pending = tx.objectStore("catalog").openCursor();
        pending.onsuccess = () => {
          const cursor = pending.result;
          if (!cursor) return;
          if (String(cursor.key).startsWith(account + ":mutation:")) cursor.delete();
          cursor.continue();
        };
        const store = tx.objectStore("content"),
          request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if ((cursor.value as Content).account === account) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    },
  };
}
