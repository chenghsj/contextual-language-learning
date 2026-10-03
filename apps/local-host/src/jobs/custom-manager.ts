import {
  CustomGenerationRequestSchema,
  type CustomGenerationRequest,
  type CustomDocument,
  type JobSummary,
} from "@immersive/core";
import {
  CUSTOM_WORKFLOW_VERSION,
  customFingerprint,
  CUSTOM_PROMPT_VERSION,
  planCustomJob,
  runCustomPipeline,
  resolveCustomModel,
  type CustomDependencies,
} from "../generation/custom-pipeline";
export class CustomJobManager {
  private starting = false;
  private closed = false;
  private running = new Map<string, AbortController>();
  constructor(
    readonly deps: CustomDependencies,
    private notify: (requestId: string, summary: JobSummary) => void,
    private otherBusy: () => boolean = () => false,
  ) {}
  isRunning() {
    return this.starting || this.running.size > 0;
  }
  async list(): Promise<JobSummary[]> {
    for (const job of await this.deps.repository.listJobs()) {
      if (!["running", "queued"].includes(job.summary.status)) continue;
      let alive = false;
      try {
        if (job.summary.ownerPid) {
          process.kill(job.summary.ownerPid, 0);
          alive = true;
        }
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code === "EPERM";
      }
      if (!alive)
        await this.deps.repository.updateJob(job.summary.id, current => ({
          ...current,
          summary: {
            ...current.summary,
            status: "waiting",
            ownerPid: undefined,
            updatedAt: new Date().toISOString(),
          },
        }));
    }
    return (await this.deps.repository.listJobs())
      .filter(job => !job.historyHidden)
      .map(job => job.summary);
  }
  async start(requestId: string, input: CustomGenerationRequest): Promise<CustomDocument> {
    if (this.isRunning() || this.otherBusy())
      throw new Error("Another generation is already running in this Host");
    this.starting = true;
    try {
      const request = await this.prepare(requestId, input);
      return this.execute(requestId, request.id);
    } finally {
      this.starting = false;
    }
  }
  async prepare(requestId: string, input: CustomGenerationRequest) {
    const request = CustomGenerationRequestSchema.parse(input);
    const model = await (this.deps.resolveModel ?? resolveCustomModel)(request.agent);
    const job = planCustomJob(request, model);
    job.summary.ownerPid = process.pid;
    await this.deps.repository.createJob(job);
    this.notify(requestId, job.summary);
    return request;
  }
  async queueFailed(requestId: string, jobId: string, error: unknown) {
    const saved = await this.deps.repository.getJob(jobId);
    if (!saved || saved.summary.status !== "queued") return;
    const message = error instanceof Error ? error.message : String(error);
    const changed = await this.deps.repository.updateJob(jobId, current =>
      current.summary.status !== "queued"
        ? current
        : {
            ...current,
            summary: {
              ...current.summary,
              status: /connection closed|aborted/i.test(message) ? "waiting" : "failed",
              ownerPid: undefined,
              error: message.slice(0, 1200),
              updatedAt: new Date().toISOString(),
            },
          },
    );
    this.notify(requestId, changed.summary);
  }
  async enqueueResume(requestId: string, jobId: string) {
    const job = await this.deps.repository.getJob(jobId);
    if (!job || !["waiting", "failed", "cancelled"].includes(job.summary.status))
      throw new Error("This job cannot be queued for recovery");
    const queued = await this.deps.repository.updateJob(jobId, current => {
      if (!["waiting", "failed", "cancelled"].includes(current.summary.status))
        throw new Error("Job state changed before recovery");
      return {
        ...current,
        summary: {
          ...current.summary,
          status: "queued",
          ownerPid: process.pid,
          error: undefined,
          retry: undefined,
          updatedAt: new Date().toISOString(),
        },
      };
    });
    this.notify(requestId, queued.summary);
  }
  async resume(requestId: string, id: string) {
    if (this.isRunning() || this.otherBusy())
      throw new Error("Another generation is already running in this Host");
    this.starting = true;
    try {
      await this.list();
      const job = await this.deps.repository.getJob(id);
      if (!job) throw new Error("Custom job not found");
      if (!["queued", "waiting", "failed", "cancelled"].includes(job.summary.status))
        throw new Error("This custom job cannot be resumed");
      if (
        job.execution.workflowVersion !== CUSTOM_WORKFLOW_VERSION ||
        job.execution.promptVersion !== CUSTOM_PROMPT_VERSION ||
        job.execution.schemaVersion !== "custom-v1"
      )
        throw new Error(
          "Unsupported saved execution version. Keep this checkpoint and regenerate as a new document.",
        );
      if (customFingerprint(job.request) !== job.execution.inputFingerprint)
        throw new Error("Saved custom input differs from the frozen snapshot");
      const model = await (this.deps.resolveModel ?? resolveCustomModel)({
        ...job.request.agent,
        provider: job.execution.provider,
        modelId: job.execution.modelId,
      });
      if (
        model.agent.provider !== job.execution.provider ||
        model.agent.modelId !== job.execution.modelId ||
        model.contextWindow !== job.execution.contextWindow ||
        model.maxOutputTokens < job.execution.maxOutputTokens
      )
        throw new Error(
          "Pinned model is unavailable or changed. Reconnect that provider or regenerate as a new document.",
        );
      return this.execute(requestId, id);
    } finally {
      this.starting = false;
    }
  }
  private async execute(requestId: string, id: string) {
    if (this.closed) throw new Error("Native Host connection closed");
    const controller = new AbortController();
    this.running.set(id, controller);
    try {
      const started = await this.deps.repository.updateJob(id, job => ({
        ...job,
        summary: {
          ...job.summary,
          status: "running",
          ownerPid: process.pid,
          error: undefined,
          retry: undefined,
          updatedAt: new Date().toISOString(),
        },
      }));
      this.notify(requestId, started.summary);
      return await runCustomPipeline(id, this.deps, controller.signal, summary =>
        this.notify(requestId, summary),
      );
    } catch (error) {
      const stopped = await this.deps.repository.updateJob(id, job =>
        job.summary.status !== "running"
          ? job
          : {
              ...job,
              summary: {
                ...job.summary,
                status: controller.signal.aborted ? "waiting" : "failed",
                ownerPid: undefined,
                error: controller.signal.aborted ? undefined : String(error).slice(0, 1200),
                updatedAt: new Date().toISOString(),
              },
            },
      );
      this.notify(requestId, stopped.summary);
      throw error;
    } finally {
      this.running.delete(id);
    }
  }
  async cancel(id: string) {
    const job = await this.deps.repository.getJob(id);
    if (!job || !["queued", "running", "waiting", "failed"].includes(job.summary.status))
      return false;
    await this.deps.repository.updateJob(id, current => ({
      ...current,
      summary: {
        ...current.summary,
        status: "cancelled",
        ownerPid: undefined,
        updatedAt: new Date().toISOString(),
      },
    }));
    this.running.get(id)?.abort();
    return true;
  }
  interruptAll() {
    this.closed = true;
    for (const controller of this.running.values()) controller.abort();
  }
}
