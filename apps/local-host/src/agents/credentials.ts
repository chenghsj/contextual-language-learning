import type { AuthOperationOptions, Credential, CredentialStore } from "@earendil-works/pi-ai";
import { lock } from "proper-lockfile";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  createSystemCredentialVault,
  SecureCredentialError,
  type CredentialVault,
} from "../platform/credential-vault";

type Credentials = Record<string, Credential>;
const queues = new Map<string, Promise<unknown>>();
async function serialize<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = resolve(root);
  const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(key) === pending) queues.delete(key);
  }
}
function parseCredentials(text: string): Credentials {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const result: Credentials = Object.create(null);
    for (const [id, raw] of Object.entries(parsed)) {
      const value = raw as Credential;
      if (!id || !value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      if (value.type === "oauth") {
        if (
          typeof value.access !== "string" ||
          typeof value.refresh !== "string" ||
          !Number.isFinite(value.expires)
        )
          throw new Error();
      } else if (value.type === "api_key") {
        if (
          value.key !== undefined &&
          (typeof value.key !== "string" || value.key.trim().startsWith("!"))
        )
          throw new Error();
        if (
          value.env !== undefined &&
          (!value.env ||
            typeof value.env !== "object" ||
            Array.isArray(value.env) ||
            Object.values(value.env).some(
              item => typeof item !== "string" || item.trim().startsWith("!"),
            ))
        )
          throw new Error();
      } else throw new Error();
      result[id] = value;
    }
    return result;
  } catch {
    throw new SecureCredentialError(
      "AI credentials are invalid. Restore the credential store or reconnect the AI service. Credential commands are not supported.",
    );
  }
}

export function legacyCredentialPaths(root: string): string[] {
  const paths = [join(root, "auth.json")];
  const config = dirname(root);
  // The earlier branding migration deliberately retained this original copy.
  if (
    basename(config) === "Contextual Language Learning" ||
    basename(config) === "contextual-language-learning"
  ) {
    paths.push(
      join(
        dirname(config),
        basename(config) === "Contextual Language Learning"
          ? "Immersive Learning"
          : "immersive-language-learning",
        "pi",
        "auth.json",
      ),
    );
  }
  return paths;
}

/** A single locked transaction covers read, token refresh, durable write and migration. */
export function createSecureCredentialStore(
  root: string,
  options: {
    vault?: CredentialVault;
    legacyPaths?: string[];
  } = {},
): CredentialStore {
  const vault = options.vault ?? createSystemCredentialVault(root);
  const paths = options.legacyPaths ?? legacyCredentialPaths(root);
  const marker = join(root, "credentials-v1");
  const migrationMarker = join(root, "credential-migration-v1");
  let pendingRead: Promise<Credentials> | undefined;
  let readBarrier: Promise<unknown> | undefined;
  const queueKey = resolve(root);
  function transaction<T>(
    fn: (data: Credentials, save: (next: Credentials) => Promise<void>) => Promise<T>,
    operation?: AuthOperationOptions,
  ): Promise<T> {
    return serialize(root, () => lockedTransaction(fn, operation));
  }
  async function lockedTransaction<T>(
    fn: (data: Credentials, save: (next: Credentials) => Promise<void>) => Promise<T>,
    operation?: AuthOperationOptions,
  ): Promise<T> {
    operation?.signal?.throwIfAborted();
    await mkdir(root, { recursive: true, mode: 0o700 });
    let compromised = false;
    const release = await lock(join(root, "credentials"), {
      realpath: false,
      stale: 120_000,
      update: 10_000,
      retries: { retries: 60, factor: 1, minTimeout: 1000, maxTimeout: 1000 },
      onCompromised: () => {
        compromised = true;
      },
    });
    const checkLock = () => {
      if (compromised)
        throw new SecureCredentialError(
          "AI credential storage lock was lost. Retry the operation.",
        );
    };
    try {
      operation?.signal?.throwIfAborted();
      const stored = await vault.read();
      let initialized = false;
      try {
        await readFile(marker);
        initialized = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (stored === undefined && initialized)
        throw new SecureCredentialError(
          "The system AI credential entry is missing or locked. Restore or unlock the system credential store before retrying.",
        );
      let data =
        stored === undefined ? (Object.create(null) as Credentials) : parseCredentials(stored);
      const save = async (next: Credentials) => {
        checkLock();
        const text = JSON.stringify(next);
        parseCredentials(text);
        await vault.write(text);
        checkLock();
        if ((await vault.read()) !== text)
          throw new SecureCredentialError(
            "AI credentials could not be verified in secure storage. Existing credentials have been preserved.",
          );
        await writeFile(marker, "System credential storage v1\n", { mode: 0o600 });
        data = next;
      };
      const legacy: { path: string; text: string }[] = [];
      for (const path of paths) {
        // Never follow a credential-file symlink during migration.
        let file;
        try {
          if ((await lstat(path)).isSymbolicLink()) throw new Error("Credential symlink");
          file = await open(
            path,
            constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw new SecureCredentialError(
            "Unable to safely read legacy AI credentials. The original file was preserved.",
          );
        }
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size > 1_000_000)
            throw new SecureCredentialError(
              "Invalid legacy AI credential file. The original file was preserved.",
            );
          legacy.push({ path, text: await file.readFile("utf8") });
        } finally {
          await file.close();
        }
      }
      if (legacy.length) {
        try {
          await readFile(migrationMarker);
          throw new SecureCredentialError(
            "Legacy AI credentials reappeared after secure migration. Stop older local services and remove the obsolete auth.json before retrying.",
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        // Secure storage wins after an interrupted migration; current branding wins over old copies.
        let merged: Credentials = Object.create(null);
        for (const item of [...legacy].reverse())
          Object.assign(merged, parseCredentials(item.text.replace(/^\uFEFF/, "")));
        Object.assign(merged, data);
        if (Object.keys(merged).length) await save(merged);
        for (const item of legacy) {
          checkLock();
          if ((await readFile(item.path, "utf8")) !== item.text)
            throw new SecureCredentialError(
              "Legacy AI credentials changed during migration. Restart the local service and retry.",
            );
          await unlink(item.path);
        }
        data = merged;
      }
      try {
        await writeFile(migrationMarker, "Legacy credential migration complete\n", {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      return await fn(data, save);
    } finally {
      await release();
    }
  }
  async function readSnapshot(operation?: AuthOperationOptions): Promise<Credentials> {
    operation?.signal?.throwIfAborted();
    // Another store for this root may have queued a mutation after our read.
    if (pendingRead && queues.get(queueKey) !== readBarrier) pendingRead = undefined;
    if (!pendingRead) {
      // Pi checks many providers concurrently. Share only an in-flight read, never
      // a settled snapshot: later requests must still observe external changes.
      const current = transaction(async data => data);
      pendingRead = current;
      readBarrier = queues.get(queueKey);
      void current
        .finally(() => {
          if (pendingRead === current) pendingRead = undefined;
        })
        .catch(() => {});
    }
    const current = pendingRead;
    const signal = operation?.signal;
    if (!signal) return current;
    // One cancelled SDK lookup must not cancel the other readers in its batch.
    return new Promise((resolveRead, reject) => {
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      current.then(
        value => {
          cleanup();
          resolveRead(value);
        },
        error => {
          cleanup();
          reject(error);
        },
      );
    });
  }
  return {
    read: async (id, operation) => structuredClone((await readSnapshot(operation))[id]),
    list: async operation =>
      Object.entries(await readSnapshot(operation)).map(([providerId, value]) => ({
        providerId,
        type: value.type,
      })),
    modify: (id, fn, operation) => {
      // New readers queue behind this mutation rather than joining an older read.
      pendingRead = undefined;
      return transaction(async (data, save) => {
        const next = await fn(data[id]);
        if (next === undefined) return data[id];
        await save({ ...data, [id]: next });
        return next;
      }, operation);
    },
    delete: (id, operation) => {
      pendingRead = undefined;
      return transaction(async (data, save) => {
        if (!Object.hasOwn(data, id)) return;
        const next = { ...data };
        delete next[id];
        await save(next);
      }, operation);
    },
  };
}
