import { createHash } from "node:crypto";
import { resolvePiModel } from "../agents/pi";
import { BUDGET_STRATEGY_VERSION } from "../agents/thinking";
import {
  GenerationRequestSchema,
  ExecutionIdentitySchema,
  readableLearningExecution,
  chunkCues,
  LEARNING_POINTS_WORKFLOW_VERSION,
  LEARNING_POINTS_PROMPT_VERSION,
  LANGUAGE_STRATEGY_VERSION,
  LEVEL_STRATEGY_VERSION,
  QUALITY_STRATEGY_VERSION,
  COMPACT_QUALITY_STRATEGY_VERSION,
  createSceneJob,
  transitionJob,
  compactProgress,
  type GenerationRequest,
  type JobSummary,
  type LearningDocument,
} from "@contextual/core";
import { runGenerationPipeline, type PipelineDependencies } from "../generation";
import { assertPiProvider } from "../agents";
import type { StoragePorts } from "../storage/ports";
import { RunningOperation, assertCancellationOwner } from "./running-operation";

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
  private readonly activities = new Map<
    string,
    Map<string, import("@contextual/core").GenerationActivity>
  >();
  private readonly summaries = new Map<string, JobSummary>();
  withActivity(summary: JobSummary): JobSummary {
    const active = this.activities.get(summary.id);
    return {
      ...summary,
      activity: summary.status === "running" && active?.size ? [...active.values()] : undefined,
    };
  }
  async getSummary(id: string) {
    const job = await this.storage.jobs.get(id);
    return job ? this.withActivity(job.summary) : null;
  }
  private starting = false;
  private closed = false;
  private readonly running = new Map<string, RunningOperation>();
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
      if (!["running", "queued"].includes(summary.status) || isAlive(summary.ownerPid)) continue;
      await this.storage.jobs.update(summary.id, current =>
        ["running", "queued"].includes(current.summary.status) && !isAlive(current.summary.ownerPid)
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
    return (await this.storage.jobs.list(50)).map(summary => this.withActivity(summary));
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
      const job = await this.prepare(requestId, request);
      return this.execute(requestId, job.summary.id, signal);
    } finally {
      this.starting = false;
    }
  }

  async prepare(requestId: string, request: GenerationRequest) {
    request = GenerationRequestSchema.parse(request);
    assertPiProvider(request.agent.provider);
    const chunks = chunkCues(request.cues).length;
    const job = createSceneJob(request, chunks);
    {
      const injected =
        this.deps.generateSection || this.deps.generateCandidates || this.deps.generateSelection;
      const resolved = injected
        ? { agent: request.agent, contextWindow: 128000, maxOutputTokens: 8192 }
        : await (this.deps.resolveModel ?? resolvePiModel)(request.agent);
      job.execution = {
        workflowVersion: LEARNING_POINTS_WORKFLOW_VERSION,
        promptVersion: LEARNING_POINTS_PROMPT_VERSION,
        schemaVersion: "7",
        ...(request.outputSchemaVersion === 7
          ? {
              languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
              levelStrategyVersion: LEVEL_STRATEGY_VERSION,
              qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
            }
          : {}),
        inputFingerprint: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        provider: resolved.agent.provider,
        modelId: resolved.agent.modelId,
        contextWindow: resolved.contextWindow,
        maxOutputTokens: resolved.maxOutputTokens,
        ...(resolved.agent.thinkingLevel !== undefined
          ? {
              effectiveThinkingLevel: resolved.agent.thinkingLevel,
              budgetStrategyVersion: BUDGET_STRATEGY_VERSION,
              effectiveSettingsFromCall: 0,
            }
          : {}),
        chunkPlan: chunkCues(request.cues).map(chunk => chunk.map(cue => cue.id)),
        calls: [],
      };
      job.summary.execution = job.execution;
      // This gate applies only at creation; recovery always uses the saved execution.
      if (
        this.deps.generationStrategy === "compact-scenes-1" &&
        (this.deps.compactAgentFilter?.(request.agent) ?? true)
      ) {
        job.execution.generationStrategyVersion = "compact-scenes-1";
        job.execution.compactQualityVersion = COMPACT_QUALITY_STRATEGY_VERSION;
        if (
          (this.deps.compactAutomaticReasoning || this.deps.compactAutomaticSelectionReasoning) &&
          request.agent.thinkingLevel === undefined
        ) {
          const light = await (this.deps.resolveModel ?? resolvePiModel)({
            ...request.agent,
            thinkingLevel: "low",
          });
          if (
            light.agent.provider !== resolved.agent.provider ||
            light.agent.modelId !== resolved.agent.modelId
          )
            throw new Error("Light-stage model differs from the frozen execution");
          if (light.agent.thinkingLevel === undefined)
            throw new Error("Light-stage reasoning was not resolved");
          job.execution.compactReasoningPolicy = {
            version: this.deps.compactAutomaticSelectionReasoning
              ? "light-selection-1"
              : "light-candidates-1",
            candidate: this.deps.compactAutomaticReasoning
              ? light.agent.thinkingLevel
              : (resolved.agent.thinkingLevel ?? light.agent.thinkingLevel),
            selection: this.deps.compactAutomaticSelectionReasoning
              ? light.agent.thinkingLevel
              : (resolved.agent.thinkingLevel ?? light.agent.thinkingLevel),
          };
        }
        job.compactPlan = {
          revision: 0,
          windows: job.learningPlan.candidateWindows.map(w => ({ id: w.id, cueIds: w.cueIds })),
        };
        job.summary = {
          ...job.summary,
          execution: job.execution,
          ...compactProgress(job.compactPlan, request.profile.sceneCount),
        };
      }
    }
    job.summary.ownerPid = process.pid;
    await this.storage.jobs.create(job);
    this.notify(requestId, job.summary);
    return job;
  }
  async queueFailed(requestId: string, jobId: string, error: unknown) {
    const saved = await this.storage.jobs.get(jobId);
    if (!saved || saved.summary.status !== "queued") return;
    const message = error instanceof Error ? error.message : String(error);
    const changed = await this.storage.jobs.update(jobId, current =>
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
    const job = await this.storage.jobs.get(jobId);
    if (!job || !["waiting", "failed", "cancelled"].includes(job.summary.status))
      throw new Error("This job cannot be queued for recovery");
    const queued = await this.storage.jobs.update(jobId, current => {
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
  async resume(requestId: string, jobId: string, signal?: AbortSignal): Promise<LearningDocument> {
    if (this.isRunning() || this.externalBusy())
      throw new Error("Another generation is already running in this Host");
    this.starting = true;
    try {
      await this.recoverInterrupted();
      const job = await this.storage.jobs.get(jobId);
      if (!job) throw new Error("Saved job not found");
      assertPiProvider(job.request.agent.provider);
      // Injected generators are used by offline tests; production resumptions must
      // have a frozen identity, including jobs written before execution metadata.
      if (
        !job.execution &&
        !this.deps.generateSection &&
        !this.deps.generateCandidates &&
        !this.deps.generateSelection
      )
        throw new Error(
          "Unsupported saved execution version; regenerate as a new lesson. The checkpoint is preserved.",
        );
      if (job.execution && !readableLearningExecution(job.execution))
        throw new Error("Unsupported saved execution version; checkpoint is preserved.");
      let resumedThinking: import("@contextual/core").ThinkingLevel | undefined;
      if (job.execution) {
        if (
          createHash("sha256").update(JSON.stringify(job.request)).digest("hex") !==
          job.execution.inputFingerprint
        )
          throw new Error("Saved input differs from frozen execution snapshot");
        const pinned =
          this.deps.generateSection || this.deps.generateCandidates || this.deps.generateSelection
            ? {
                contextWindow: job.execution.contextWindow,
                maxOutputTokens: job.execution.maxOutputTokens,
              }
            : await (this.deps.resolveModel ?? resolvePiModel)({
                ...job.request.agent,
                provider: job.execution.provider,
                modelId: job.execution.modelId,
                thinkingLevel:
                  job.execution.effectiveThinkingLevel ?? job.request.agent.thinkingLevel,
              });
        if ("agent" in pinned) resumedThinking = pinned.agent.thinkingLevel;
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
      if (
        job.execution &&
        job.execution.effectiveThinkingLevel === undefined &&
        resumedThinking !== undefined
      ) {
        job.execution = {
          ...job.execution,
          effectiveThinkingLevel: resumedThinking,
          budgetStrategyVersion: BUDGET_STRATEGY_VERSION,
          effectiveSettingsFromCall: job.execution.calls.length,
        };
        await this.storage.jobs.update(jobId, current => ({
          ...current,
          execution: job.execution,
          summary: { ...current.summary, execution: job.execution },
        }));
      }
      // An explicit resume upgrades only unfinished work. Keep completed results and
      // paid call history, and record the previous identity instead of relabelling it.
      if (
        job.schemaVersion === 5 &&
        job.execution &&
        job.execution.promptVersion !== LEARNING_POINTS_PROMPT_VERSION
      ) {
        // A crash may leave the canonical lesson saved before the completed status.
        // Finish that commit under its original identity instead of changing the saved lesson.
        if (job.learningPlan.batches.length && job.learningPlan.batches.every(b => b.result)) {
          const saved = await this.storage.documents.get(jobId);
          if (saved) {
            if (
              saved.execution?.inputFingerprint !== job.execution.inputFingerprint ||
              JSON.stringify(saved.cues) !== JSON.stringify(job.request.cues)
            )
              throw new Error("Saved document conflicts with frozen execution");
            const completed = await this.storage.jobs.update(jobId, current => ({
              ...current,
              summary: {
                ...current.summary,
                status: "completed",
                documentId: jobId,
                ownerPid: undefined,
                error: undefined,
                updatedAt: new Date().toISOString(),
              },
            }));
            this.notify(requestId, completed.summary);
            return saved;
          }
        }
        await this.storage.jobs.update(jobId, current => {
          if (current.schemaVersion !== 5 || !current.execution)
            throw new Error("Missing saved execution");
          const execution = {
            ...current.execution,
            previousExecution: ExecutionIdentitySchema.parse(current.execution),
            promptVersion: LEARNING_POINTS_PROMPT_VERSION,
            languageStrategyVersion: LANGUAGE_STRATEGY_VERSION,
            levelStrategyVersion: LEVEL_STRATEGY_VERSION,
            qualityStrategyVersion: QUALITY_STRATEGY_VERSION,
          };
          return {
            ...current,
            execution,
            summary: { ...current.summary, execution },
            learningPlan: {
              ...current.learningPlan,
              batches: current.learningPlan.batches.map(batch =>
                batch.result
                  ? batch
                  : {
                      ...batch,
                      quality: undefined,
                      repairAttempted: undefined,
                      lastIssue: undefined,
                      pendingPronunciation: undefined,
                      draftPronunciationDiagnostics: undefined,
                    },
              ),
            },
          };
        });
      }
      return this.execute(requestId, jobId, signal);
    } finally {
      this.starting = false;
    }
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = await this.storage.jobs.get(jobId);
    if (!job) return false;
    const operation = this.running.get(jobId);
    if (!operation) assertCancellationOwner(job.summary.ownerPid);
    if (operation) await operation.cancel();
    const settled = await this.storage.jobs.get(jobId);
    if (settled?.summary.status === "cancelled") return true;
    if (!settled || !["queued", "running", "waiting", "failed"].includes(settled.summary.status))
      return false;
    const updated = await this.storage.jobs.update(jobId, current => {
      if (!["queued", "running", "waiting", "failed"].includes(current.summary.status))
        return current;
      const next = transitionJob(current, "cancelled");
      return { ...next, summary: { ...next.summary, ownerPid: undefined } };
    });
    return updated.summary.status === "cancelled";
  }

  private async execute(
    requestId: string,
    jobId: string,
    signal?: AbortSignal,
  ): Promise<LearningDocument> {
    if (this.closed) throw new Error("Native Host connection closed");
    const operation = new RunningOperation();
    const controller = operation.controller;
    const externalAbort = () => controller.abort();
    signal?.addEventListener("abort", externalAbort, { once: true });
    if (signal?.aborted) controller.abort();
    this.running.set(jobId, operation);
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
      this.summaries.set(jobId, started.summary);
      const document = await runGenerationPipeline(
        jobId,
        {
          ...this.deps,
          onActivity: (id, step, activity) => {
            let active = this.activities.get(id);
            if (!active) {
              active = new Map();
              this.activities.set(id, active);
            }
            if (activity) active.set(step, activity);
            else active.delete(step);
            const summary = this.summaries.get(id);
            if (summary) this.notify(requestId, this.withActivity(summary));
            this.deps.onActivity?.(id, step, activity);
          },
        },
        controller.signal,
        summary => {
          this.summaries.set(jobId, summary);
          this.notify(requestId, this.withActivity(summary));
        },
      );
      return document;
    } catch (error) {
      const updated = await this.storage.jobs.update(jobId, current => {
        if (current.summary.status !== "running") return current;
        const next = transitionJob(
          current,
          controller.signal.aborted
            ? operation.cancelRequested
              ? "cancelled"
              : "waiting"
            : "failed",
        );
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
      if (["failed", "waiting", "cancelled"].includes(updated.summary.status)) {
        this.notify(requestId, updated.summary);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", externalAbort);
      this.activities.delete(jobId);
      this.summaries.delete(jobId);
      this.running.delete(jobId);
      operation.finish();
    }
  }

  /** Called when the native messaging pipe closes; checkpoints survive this process. */
  interruptAll(): void {
    this.closed = true;
    for (const operation of this.running.values()) operation.controller.abort();
  }
}
