import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { type JobSnapshot, type CustomJobSnapshot } from "@contextual/core";
import { JobManager } from "./manager";
import { CustomJobManager } from "./custom-manager";
import { localStoragePorts } from "../storage/file";
import { FileCustomRepository } from "../storage/custom";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const kind of ["standard", "custom"] as const) {
  test(
    kind + " cancellation waits for the AI execution to settle before acknowledging",
    async () => {
      const entered = deferred(),
        aborted = deferred(),
        release = deferred();
      const generate = async (_agent: unknown, _prompt: unknown, signal: AbortSignal) => {
        entered.resolve();
        signal.addEventListener("abort", aborted.resolve, { once: true });
        await release.promise;
        throw new Error("AI aborted after cleanup");
      };
      const id = randomUUID();
      const source = { platform: "import" as const, title: "Cancel in flight" };
      const agent = { provider: "openai" as const, modelId: "fixture" };
      const cues = [{ id: "cue", startMs: 0, endMs: 1000, originalText: "Hello." }];
      let cancel: () => Promise<boolean>,
        start: Promise<unknown>,
        status: () => Promise<string | undefined>;
      if (kind === "standard") {
        const storage = localStoragePorts("/unused-cancellation-fixture");
        const jobs = new Map<string, JobSnapshot>();
        storage.jobs.create = async job => {
          jobs.set(job.summary.id, structuredClone(job));
        };
        storage.jobs.get = async id => structuredClone(jobs.get(id) ?? null);
        storage.jobs.update = async (id, change) => {
          const job = change(structuredClone(jobs.get(id)!));
          jobs.set(id, job);
          return structuredClone(job);
        };
        const manager = new JobManager({ storage, generateCandidates: generate }, () => {});
        start = manager.start(id, {
          outputSchemaVersion: 7,
          id,
          source,
          agent,
          cues,
          profile: {
            targetLanguage: "en",
            instructionLanguage: "zh-TW",
            level: "B1",
            sceneCount: 2,
            contextualExampleCount: 1,
          },
        });
        cancel = () => manager.cancel(id);
        status = async () => (await storage.jobs.get(id))?.summary.status;
      } else {
        const repository = new FileCustomRepository("/unused-cancellation-fixture");
        const jobs = new Map<string, CustomJobSnapshot>();
        repository.createJob = async job => {
          jobs.set(job.summary.id, structuredClone(job));
        };
        repository.getJob = async id => structuredClone(jobs.get(id) ?? null);
        repository.updateJob = async (id, change) => {
          const job = change(structuredClone(jobs.get(id)!));
          jobs.set(id, job);
          return structuredClone(job);
        };
        const manager = new CustomJobManager(
          {
            repository,
            resolveModel: async () => ({ agent, contextWindow: 16384, maxOutputTokens: 4096 }),
            generate,
          },
          () => {},
        );
        start = manager.start(id, {
          id,
          kind: "custom",
          source,
          agent,
          cues,
          prompt: "Explain",
          context: { subtitles: true, title: true },
          backup: { enabled: false },
        });
        cancel = () => manager.cancel(id);
        status = async () => (await repository.getJob(id))?.summary.status;
      }
      const stopped = assert.rejects(start, /aborted/);
      let acknowledged = false;
      try {
        await entered.promise;
        const cancelling = cancel().then(value => {
          acknowledged = true;
          return value;
        });
        await aborted.promise;
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(
          acknowledged,
          false,
          "AI cleanup is still blocked: cancellation must not be acknowledged",
        );
        assert.notEqual(await status(), "cancelled");
        release.resolve();
        assert.equal(await cancelling, true);
        await stopped;
        assert.equal(await status(), "cancelled");
        assert.equal(await cancel(), true, "acknowledgement retries are idempotent");
      } finally {
        release.resolve();
        await stopped;
      }
    },
  );
}
