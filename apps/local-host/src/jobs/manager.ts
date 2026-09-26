import { chunkCues, createJob, createSceneJob, transitionJob, type GenerationRequest, type JobSummary, type LearningDocument } from "@immersive/core";
import { runGenerationPipeline, type PipelineDependencies } from "../generation";
import { assertImportedAgentProvider } from "../agents";
import type { StoragePorts } from "../storage/ports";
import { findExisting, publishDocument } from "../storage/publisher";
import { validateUserStoragePath } from "../storage/locations";

function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this process is not allowed to signal it.
    return !!error && typeof error === "object" && "code" in error && error.code === "EPERM";
  }
}

export class JobManager {
  private readonly running = new Map<string, AbortController>();
  constructor(
    private readonly deps: PipelineDependencies,
    private readonly notify: (requestId: string, summary: JobSummary) => void,
  ) {}

  private get storage(): StoragePorts { return this.deps.storage; }

  /** Only orphaned running jobs are marked waiting; a separate live Host must be left alone. */
  async recoverInterrupted(): Promise<void> {
    for (const summary of await this.storage.jobs.list(Number.MAX_SAFE_INTEGER)) {
      if (summary.status !== "running" || isAlive(summary.ownerPid)) continue;
      await this.storage.jobs.update(summary.id, current =>
        current.summary.status === "running" && !isAlive(current.summary.ownerPid)
          ? { ...transitionJob(current, "waiting"), summary: {
              ...current.summary, status: "waiting", ownerPid: undefined,
              updatedAt: new Date().toISOString(),
            } }
          : current,
      );
    }
  }

  async list(): Promise<JobSummary[]> {
    await this.recoverInterrupted();
    return this.storage.jobs.list(50);
  }

  async start(requestId: string, request: GenerationRequest, signal?: AbortSignal): Promise<LearningDocument> {
    assertImportedAgentProvider(request.agent.provider);
    if (this.running.size) throw new Error("Another generation is already running in this Host");
    if (request.outputPath) {
      const root = validateUserStoragePath(request.outputPath);
      const existing = await findExisting(root, request);
      if (existing.length && !request.allowRegenerate) {
        throw new Error("This source already has generated learning material. Confirm regeneration first.");
      }
    }
    const chunks = chunkCues(request.cues).length;
    const job = this.deps.legacyGeneration ? createJob(request, chunks) : createSceneJob(request, chunks);
    await this.storage.jobs.create(job);
    return this.execute(requestId, job.summary.id, signal);
  }

  async resume(requestId: string, jobId: string, signal?: AbortSignal): Promise<LearningDocument> {
    if (this.running.size) throw new Error("Another generation is already running in this Host");
    await this.recoverInterrupted();
    const job = await this.storage.jobs.get(jobId);
    if (!job) throw new Error("Saved job not found");
    // Leave historical checkpoints intact; removed built-in adapters cannot resume them.
    assertImportedAgentProvider(job.request.agent.provider);
    if (!["queued", "waiting", "failed"].includes(job.summary.status)) {
      throw new Error("This job cannot be resumed from status: " + job.summary.status);
    }
    return this.execute(requestId, jobId, signal);
  }

  async cancel(jobId: string): Promise<boolean> {
    this.running.get(jobId)?.abort();
    const job = await this.storage.jobs.get(jobId);
    if (!job || !["queued", "running", "waiting", "failed"].includes(job.summary.status)) return false;
    await this.storage.jobs.update(jobId, current => {
      if (!["queued", "running", "waiting", "failed"].includes(current.summary.status)) return current;
      const next = transitionJob(current, "cancelled");
      return { ...next, summary: { ...next.summary, ownerPid: undefined } };
    });
    return true;
  }

  private async execute(requestId: string, jobId: string, signal?: AbortSignal): Promise<LearningDocument> {
    const controller = new AbortController();
    const externalAbort = () => controller.abort();
    signal?.addEventListener("abort", externalAbort, { once: true });
    if (signal?.aborted) controller.abort();
    this.running.set(jobId, controller);
    try {
      const started = await this.storage.jobs.update(jobId, current => {
        if (current.summary.status === "failed" || current.summary.status === "waiting") {
          current = transitionJob(current, "queued");
        }
        const next = transitionJob(current, "running");
        return { ...next, summary: { ...next.summary, ownerPid: process.pid, error: undefined } };
      });
      this.notify(requestId, started.summary);
      const document = await runGenerationPipeline(jobId, this.deps, controller.signal, summary => this.notify(requestId, summary));
      const saved = await this.storage.jobs.get(jobId);
      if (saved?.request.outputPath) {
        await publishDocument(validateUserStoragePath(saved.request.outputPath), document);
      }
      return document;
    } catch (error) {
      const updated = await this.storage.jobs.update(jobId, current => {
        if (current.summary.status !== "running") return current;
        const next = transitionJob(current, controller.signal.aborted ? "waiting" : "failed");
        return {
          ...next, summary: {
            ...next.summary, ownerPid: undefined,
            error: controller.signal.aborted ? undefined :
              (error instanceof Error ? error.message : String(error)).slice(0, 1200),
          },
        };
      });
      // Persist the terminal checkpoint first, then send the real status to
      // any open Side Panel. The error message alone cannot update a progress bar.
      if (updated.summary.status === "failed" || updated.summary.status === "waiting") {
        this.notify(requestId, updated.summary);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", externalAbort);
      this.running.delete(jobId);
    }
  }

  /** Called when the native messaging pipe closes; checkpoints survive this process. */
  interruptAll(): void {
    for (const controller of this.running.values()) controller.abort();
  }
}
