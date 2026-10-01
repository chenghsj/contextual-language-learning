import { createHash } from "node:crypto";
import type { StoragePorts } from "./ports";

// Scoped to a repository instance in the shared Host process. Rejected work releases its slot.
const queues = new WeakMap<StoragePorts["jobs"], Map<string, Promise<unknown>>>();
export function serializeDocument<T>(
  storage: StoragePorts,
  id: string,
  work: () => Promise<T>,
): Promise<T> {
  let queue = queues.get(storage.jobs);
  if (!queue) {
    queue = new Map();
    queues.set(storage.jobs, queue);
  }
  const next = (queue.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
  queue.set(id, next);
  void next
    .finally(() => {
      if (queue!.get(id) === next) queue!.delete(id);
    })
    .catch(() => {});
  return next;
}
export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function documentRevision(document: unknown): string {
  return contentHash(JSON.stringify(canonical(document)));
}
