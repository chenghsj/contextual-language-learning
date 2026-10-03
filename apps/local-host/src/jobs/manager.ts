import { createHash } from "node:crypto";
import { resolvePiModel } from "../agents/pi";
import {
  chunkCues,
  createSceneJob,
  transitionJob,
  type GenerationRequest,
  type JobSummary,
  type LearningDocument,
} from "@immersive/core";
import { runGenerationPipeline, type PipelineDependencies } from "../generation";
import { assertPiProvider } from "../agents";
import type { StoragePorts } from "../storage/ports";

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
  private externalBusy: () => boolean = () => false;
  isRunning() {
    return this.starting || this.running.size > 0;
  }
  setExternalBusyGuard(guard: () => boolean) {
    this.externalBusy = guard;
  }
  private starting = false;
  private readonly running = new Map<string, AbortController>();
  constructor(
    private readonly deps: PipelineDependencies,
    private readonly notify: (requestId: string, summary: JobSummary) => void,
  ) {}

  private get storage(): StoragePorts {
    return this.deps.storage;
  }

  /** Only orphaned running jobs are marked waiting; a separate live Host must be left alone. */
  async recoverInterrupted(): Promise<void> {
    for (const summary of await this.storage.jobs.list(Number.MAX_SAFE_INTEGER)) {
      if (summary.status !== "running" || isAlive(summary.ownerPid)) continue;
      await this.storage.jobs.update(summary.id, current =>
        current.summary.status === "running" && !isAlive(current.summary.ownerPid)
          ? {
              ...transitionJob(current, "waiting"),
              summary: {
                ...current.summary,
                status: "waiting",
                ownerPid: undefined,
                updatedAt: new Date().toISOString(),
              },
            }
          : current,
      );
    }
  }

  async list(): Promise<JobSummary[]> {
    await this.recoverInterrupted();
    return this.storage.jobs.list(50);
  }

  async start(
    requestId: string,
    request: GenerationRequest,
    signal?: AbortSignal,
  ): Promise<LearningDocument> {
    assertPiProvider(request.agent.provider);
    if (this.isRunning() || this.externalBusy())
      throw new Error("Another generation is already running in this Host");
    this.starting = true;
    try {
      const chunks = chunkCues(request.cues).length;
      const job = createSceneJob(request, chunks);
      if (
        !this.deps.generateSection &&
        !this.deps.generateCandidates &&
        !this.deps.generateSelection
      ) {
        const resolved = await resolvePiModel(request.agent);
        job.execution = {
          workflowVersion: "scene-v5-1",
          promptVersion: "scene-prompts-1",
          schemaVersion: "5",
          inputFingerprint: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
          provider: resolved.agent.provider,
          modelId: resolved.agent.modelId,
          contextWindow: resolved.contextWindow,
          maxOutputTokens: resolved.maxOutputTokens,
          chunkPlan: chunkCues(request.cues).map(chunk => chunk.map(cue => cue.id)),
          calls: [],
        };
        job.summary.execution = job.execution;
      }
      await this.storage.jobs.create(job);
      return this.execute(requestId, job.summary.id, signal);
    } finally {
      this.starting = false;
    }
  }

  async resume(requestId: string, jobId: string, signal?: AbortSignal): Promise<LearningDocument> {
    if (this.isRunning() || this.externalBusy())
      throw new Error("Another generation is already running in this Host");
    this.starting = true;
    try {
      await this.recoverInterrupted();
      const job = await this.storage.jobs.get(jobId);
      if (!job) throw new Error("Saved job not found");
      assertPiProvider(job.request.agent.provider);
      if (
        job.execution &&
        (job.execution.workflowVersion !== "scene-v5-1" ||
          job.execution.promptVersion !== "scene-prompts-1" ||
          job.execution.schemaVersion !== "5")
      )
        throw new Error(
          "Unsupported saved execution version; regenerate as a new lesson. The checkpoint is preserved.",
        );
      if (job.execution) {
        if (
          createHash("sha256").update(JSON.stringify(job.request)).digest("hex") !==
          job.execution.inputFingerprint
        )
          throw new Error("Saved input differs from frozen execution snapshot");
        const pinned = await resolvePiModel({
          ...job.request.agent,
          provider: job.execution.provider,
          modelId: job.execution.modelId,
        });
        if (
          pinned.contextWindow !== job.execution.contextWindow ||
          pinned.maxOutputTokens !== job.execution.maxOutputTokens ||
          JSON.stringify(chunkCues(job.request.cues).map(chunk => chunk.map(cue => cue.id))) !==
            JSON.stringify(job.execution.chunkPlan)
        )
          throw new Error(
            "Pinned execution model or plan changed. Regenerate as a new lesson; checkpoint is preserved.",
          );
      }
      if (!["queued", "waiting", "failed", "cancelled"].includes(job.summary.status)) {
        throw new Error("This job cannot be resumed from status: " + job.summary.status);
      }
      return this.execute(requestId, jobId, signal);
    } finally {
      this.starting = false;
    }
  }

  async cancel(jobId: string): Promise<boolean> {
    this.running.get(jobId)?.abort();
    const job = await this.storage.jobs.get(jobId);
    if (!job || !["queued", "running", "waiting", "failed"].includes(job.summary.status))
      return false;
    await this.storage.jobs.update(jobId, current => {
      if (!["queued", "running", "waiting", "failed"].includes(current.summary.status))
        return current;
      const next = transitionJob(current, "cancelled");
      return { ...next, summary: { ...next.summary, ownerPid: undefined } };
    });
    return true;
  }

  private async execute(
    requestId: string,
    jobId: string,
    signal?: AbortSignal,
  ): Promise<LearningDocument> {
    const controller = new AbortController();
    const externalAbort = () => controller.abort();
    signal?.addEventListener("abort", externalAbort, { once: true });
    if (signal?.aborted) controller.abort();
    this.running.set(jobId, controller);
    try {
      const started = await this.storage.jobs.update(jobId, current => {
        if (
          current.summary.status === "failed" ||
          current.summary.status === "waiting" ||
          current.summary.status === "cancelled"
        ) {
          current = transitionJob(current, "queued");
        }
        const next = transitionJob(current, "running");
        return { ...next, summary: { ...next.summary, ownerPid: process.pid, error: undefined } };
      });
      this.notify(requestId, started.summary);
      const document = await runGenerationPipeline(jobId, this.deps, controller.signal, summary =>
        this.notify(requestId, summary),
      );
      return document;
    } catch (error) {
      const updated = await this.storage.jobs.update(jobId, current => {
        if (current.summary.status !== "running") return current;
        const next = transitionJob(current, controller.signal.aborted ? "waiting" : "failed");
        return {
          ...next,
          summary: {
            ...next.summary,
            ownerPid: undefined,
            error: controller.signal.aborted
              ? undefined
              : (error instanceof Error ? error.message : String(error)).slice(0, 1200),
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
