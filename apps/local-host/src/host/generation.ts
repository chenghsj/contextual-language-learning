import { randomUUID } from "node:crypto";
import type {
  DuplicateMatch,
  GenerationRequest,
  HostRequest,
  LearningDocument,
} from "@immersive/core";
import { assertPiProvider } from "../agents";
import { findLocalDuplicates, requestKey } from "../duplicates";
import { findDriveDuplicates } from "../drive/api";
import { validateFolder } from "../storage/folders";
import type { HostDispatcherDeps } from "./context";

/** Duplicate tickets and resumable Agent work share the same Host lifetime. */
export function createGenerationHandler(
  { storage, manager, reply }: Pick<HostDispatcherDeps, "storage" | "manager" | "reply">,
  finishDocument: (id: string, document: LearningDocument) => Promise<void>,
) {
  const checks = new Map<string, { fingerprint: string; shown: Set<string>; expires: number }>();
  async function duplicates(request: GenerationRequest): Promise<DuplicateMatch[]> {
    if (request.destination?.kind === "drive") {
      // A remote permission/authentication failure must never be reported as "no duplicates".
      const [local, remote] = await Promise.all([
        findLocalDuplicates(request, storage),
        findDriveDuplicates(request),
      ]);
      const found = new Map<string, DuplicateMatch>();
      for (const entry of [...remote, ...local]) {
        const previous = found.get(entry.documentId);
        found.set(entry.documentId, previous && previous.local ? previous : entry);
      }
      return [...found.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100);
    }
    await validateFolder(
      request.destination?.kind === "local" ? request.destination.directory : undefined,
    );
    return findLocalDuplicates(request, storage);
  }

  async function handle(request: HostRequest): Promise<boolean> {
    switch (request.type) {
      case "checkDuplicates": {
        const matches = await duplicates(request.payload);
        const token = randomUUID();
        checks.set(token, {
          fingerprint: requestKey(request.payload),
          shown: new Set(matches.map(item => item.documentId)),
          expires: Date.now() + 10 * 60_000,
        });
        reply({ id: request.id, type: "duplicates", token, matches });
        return true;
      }
      case "generate": {
        assertPiProvider(request.payload.agent.provider);
        const checked = checks.get(request.checkToken);
        if (
          !checked ||
          checked.expires < Date.now() ||
          checked.fingerprint !== requestKey(request.payload)
        ) {
          throw new Error("請先檢查是否已有教材；生成設定變更後必須重新檢查");
        }
        // Recheck immediately before creating a job; don't authorize newly appeared duplicates.
        const current = await duplicates(request.payload);
        if (current.some(item => !checked.shown.has(item.documentId))) {
          throw new Error("找到新的既有教材，請重新檢查再決定是否生成");
        }
        if (current.length && !request.confirmRegeneration) {
          throw new Error("此來源已生成過；請先確認是否重新生成");
        }
        checks.delete(request.checkToken);
        const doc = await manager.start(request.id, request.payload);
        await finishDocument(request.id, doc);
        return true;
      }
      case "cancel": {
        const cancelled = await manager.cancel(request.jobId);
        if (!cancelled) throw new Error("Job is not cancellable or does not exist");
        reply({ id: request.id, type: "cancelled" });
        return true;
      }
      case "resume":
        await finishDocument(request.id, await manager.resume(request.id, request.jobId));
        return true;
      default:
        return false;
    }
  }
  return handle;
}
