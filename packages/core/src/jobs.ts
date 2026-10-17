import { QualityCheckpointSchema } from "./quality";
import { assertAtomicUnitSplit, validateUnitCoverage } from "./source-units";
import {
  ExecutionIdentitySchema,
  ExecutionMetadataSchema,
  PronunciationDiagnosticSchema,
  pronunciationMissingCount,
} from "./execution";
import { z } from "zod";
import { ExplanationTypeSchema } from "./explanations";
import { validateLearningDocumentV7 } from "./learning-points";
import { chunkCues } from "./subtitles";
import {
  RETIRED_LESSON_MESSAGE,
  readableLearningExecution,
  GenerationRequestSchema,
  LearningSceneV7Schema,
  LearningPointSchema,
  ReusableItemSchema,
  SourceUtteranceSchema,
  type GenerationRequest,
  type LearningDocument,
} from "./schema";

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const GenerationActivitySchema = z.object({
  id: z.string().min(1).max(240),
  step: z.string().min(1).max(240),
  state: z.enum(["waiting", "thinking", "writing", "retrying"]),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GenerationActivity = z.infer<typeof GenerationActivitySchema>;
export const JobSummarySchema = z.object({
  activity: z.array(GenerationActivitySchema).max(2).optional(),
  kind: z.enum(["standard", "custom"]).optional(),
  execution: ExecutionIdentitySchema.optional(),
  id: z.string().uuid(),
  sourceTitle: z.string(),
  provider: z.string(),
  status: JobStatusSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  phase: z.enum(["analyzing", "selecting", "creating", "checking", "saving"]).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  retry: z
    .object({
      attempt: z.number().int().min(1).max(2),
      delayMs: z.number().nonnegative(),
      reason: z.string().max(500),
    })
    .optional(),
  error: z.string().optional(),
  pronunciationMissingCount: z.number().int().nonnegative().optional(),
  documentId: z.string().uuid().optional(),
  ownerPid: z.number().int().positive().optional(),
  publication: z
    .object({
      status: z.enum(["pending", "published", "failed"]),
      location: z.string().optional(),
      error: z.string().optional(),
      revision: z.string().length(64).optional(),
      attemptHashes: z
        .object({ json: z.string().length(64), markdown: z.string().length(64) })
        .optional(),
      authorizedHashes: z
        .array(z.object({ json: z.string().length(64), markdown: z.string().length(64) }))
        .optional(),
      syncedHashes: z
        .object({ json: z.string().length(64), markdown: z.string().length(64) })
        .optional(),
    })
    .optional(),
  backup: z
    .object({
      status: z.enum(["pending", "uploading", "backed-up", "failed", "conflict", "paused"]),
      accountId: z.string().min(1).max(256),
      location: z.string().optional(),
      error: z.string().optional(),
      revision: z.string().length(64).optional(),
      updatedAt: z.string().datetime(),
    })
    .optional(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const LearningCandidateSchema = z
  .object({
    id: z.string().uuid(),
    dialogueCueIds: z.array(z.string()).min(1),
    contextCueIds: z.array(z.string()),
    utterances: z.array(SourceUtteranceSchema).min(1),
    learningValue: z.string().min(1).max(1500),
    opportunities: z.array(
      z
        .object({
          category: ExplanationTypeSchema,
          sourceCueIds: z.array(z.string()).min(1),
          description: z.string().min(1).max(1500),
        })
        .strict(),
    ),
  })
  .strict();
export type LearningCandidate = z.infer<typeof LearningCandidateSchema>;
export const LearningBatchSchema = z.object({
  quality: QualityCheckpointSchema.optional(),
  id: z.string(),
  sceneId: z.string().uuid(),
  utteranceIds: z.array(z.string()).min(1),
  // Host-only retry state. The model, learning strategy and completed results stay frozen.
  outputTokenBudget: z.number().int().min(1024).optional(),
  repairAttempted: z.boolean().optional(),
  draftPronunciationDiagnostics: z.array(PronunciationDiagnosticSchema).optional(),
  pronunciationDiagnostics: z.array(PronunciationDiagnosticSchema).optional(),
  lastIssue: z
    .object({
      code: z.enum(["validation_error", "truncated_output"]),
      path: z.string(),
      description: z.string().max(12000),
      outputTokenBudget: z.number().int().min(1024).optional(),
    })
    .optional(),
  pendingTeaching: z
    .object({
      draft: z.record(z.unknown()),
      diagnostics: z.array(PronunciationDiagnosticSchema),
    })
    .optional(),
  pendingPronunciation: z
    .object({
      draft: z.record(z.unknown()),
      targets: z.array(z.string().min(1)),
      diagnostics: z.array(PronunciationDiagnosticSchema),
      repairStarted: z.boolean(),
    })
    .optional(),
  result: z
    .object({
      section: LearningSceneV7Schema,
      points: z.array(LearningPointSchema),
      reusableItems: z.array(ReusableItemSchema),
    })
    .optional(),
});
export const JobSnapshotV5Schema = z
  .object({
    schemaVersion: z.literal(5),
    execution: ExecutionMetadataSchema.optional(),
    summary: JobSummarySchema,
    request: GenerationRequestSchema.refine(
      r => r.outputSchemaVersion === 7,
      "V5 job requires V7 request",
    ),
    sections: z.array(LearningSceneV7Schema).max(6),
    learningPlan: z.object({
      candidateWindows: z.array(
        z.object({
          id: z.string(),
          cueIds: z.array(z.string()).min(1),
          candidates: z.array(LearningCandidateSchema).optional(),
          repairAttempted: z.boolean().optional(),
        }),
      ),
      selected: z.array(LearningCandidateSchema).min(1).max(6).optional(),
      batches: z.array(LearningBatchSchema),
      selectionRepairs: z.array(z.string()).default([]),
      selectionGroups: z
        .array(
          z.object({
            id: z.string(),
            candidateIds: z.array(z.string()),
            selectedIds: z.array(z.string()),
          }),
        )
        .default([]),
    }),
  })
  .superRefine((job, ctx) => {
    if (
      job.summary.id !== job.request.id ||
      new Set(job.learningPlan.batches.map(b => b.id)).size !== job.learningPlan.batches.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Job identity or batch plan is inconsistent",
      });
    const p = job.learningPlan;
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (
      JSON.stringify(p.candidateWindows.flatMap(w => w.cueIds)) !==
      JSON.stringify(job.request.cues.map(c => c.id))
    )
      issue("Candidate windows must partition frozen source");
    const candidates = p.candidateWindows.flatMap(w => w.candidates ?? []);
    if (new Set(candidates.map(c => c.id)).size !== candidates.length)
      issue("Duplicate candidate identity");
    if (p.selected) {
      if (p.selected.some(s => !candidates.some(c => JSON.stringify(c) === JSON.stringify(s))))
        issue("Selection differs from validated candidates");
      for (const scene of p.selected) {
        try {
          validateUnitCoverage(scene.utterances, scene.dialogueCueIds, job.request.cues);
          assertAtomicUnitSplit(
            p.batches.filter(b => b.sceneId === scene.id).map(b => b.utteranceIds),
            scene.utterances,
          );
        } catch (e) {
          issue(String(e));
        }
        if (
          JSON.stringify(
            p.batches.filter(b => b.sceneId === scene.id).flatMap(b => b.utteranceIds),
          ) !== JSON.stringify(scene.utterances.map(u => u.id))
        )
          issue("Batches must partition selected utterances");
      }
      if (p.batches.some(b => !p.selected!.some(s => s.id === b.sceneId)))
        issue("Unknown batch scene");
    } else if (p.batches.length) issue("Teaching requires a saved selection");
    for (const batch of p.batches) {
      if (batch.quality) {
        const q = batch.quality;
        if (
          (batch.result && q.phase !== "accepted") ||
          (q.review && (!q.reviewHash || q.reviewDraftHash !== q.originalDraftHash)) ||
          (q.recheck && (!q.recheckHash || q.recheckDraftHash !== q.draftHash))
        )
          issue("Quality checkpoint phase or evidence is inconsistent");
        if (
          q.phase === "accepted" &&
          (q.recheck ?? q.review)?.issues.some(i => i.severity === "error")
        )
          issue("Major quality issues cannot be accepted");
        if (q.phase === "blocked" && q.repairEligible)
          issue("Blocked quality cannot renew repair eligibility");
      }
      if (
        job.execution &&
        batch.outputTokenBudget !== undefined &&
        batch.outputTokenBudget >
          Math.min(job.execution.maxOutputTokens, Math.floor(job.execution.contextWindow / 4))
      )
        issue("Teaching output budget exceeds frozen model capacity");
      if (batch.pendingTeaching && batch.result)
        issue("Pending teaching cannot coexist with a completed result");
      if (
        batch.pendingPronunciation &&
        (batch.result ||
          !batch.repairAttempted ||
          !batch.pendingPronunciation.targets.length ||
          new Set(batch.pendingPronunciation.targets).size !==
            batch.pendingPronunciation.targets.length)
      )
        issue("Pending pronunciation checkpoint is inconsistent");
      for (const d of [
        ...(batch.draftPronunciationDiagnostics ?? []),
        ...(batch.pronunciationDiagnostics ?? []),
        ...(batch.pendingPronunciation?.diagnostics ?? []),
      ])
        if (d.batchId !== batch.id || d.sceneId !== batch.sceneId)
          issue("Pronunciation diagnostic batch identity mismatch");
      if (
        batch.pronunciationDiagnostics?.some(d => d.action === "pending") ||
        (batch.pronunciationDiagnostics && !batch.result)
      )
        issue("Final pronunciation diagnostics require a validated result");
    }
    if (
      job.summary.pronunciationMissingCount !== undefined &&
      job.summary.pronunciationMissingCount !==
        pronunciationMissingCount(p.batches.flatMap(b => b.pronunciationDiagnostics ?? []))
    )
      issue("Pronunciation missing count differs from checkpoint");
    for (const batch of p.batches)
      if (
        batch.result &&
        (batch.result.section.id !== batch.sceneId ||
          JSON.stringify(batch.result.section.utterances.map(u => u.id)) !==
            JSON.stringify(batch.utteranceIds))
      )
        issue("Completed batch coverage differs from its plan");
    const completed =
      p.candidateWindows.filter(w => w.candidates !== undefined).length +
      (p.selected ? 1 : 0) +
      p.batches.filter(b => b.result).length;
    const total =
      p.candidateWindows.length +
      1 +
      (p.selected ? p.batches.length : job.request.profile.sceneCount);
    if (
      job.summary.completed !== completed ||
      job.summary.total !== total ||
      (job.summary.status === "completed" &&
        (completed !== total || job.summary.documentId !== job.summary.id))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "V7 checkpoint progress is inconsistent",
      });
  });
export type JobSnapshotV5 = z.infer<typeof JobSnapshotV5Schema>;
export const JobSnapshotSchema = JobSnapshotV5Schema;
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;

const allowed: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["waiting", "completed", "failed", "cancelled"],
  waiting: ["queued", "cancelled"],
  failed: ["queued", "cancelled"],
  completed: [],
  cancelled: ["queued"],
};

export function transitionJob(
  job: JobSnapshot,
  to: JobStatus,
  now = new Date().toISOString(),
): JobSnapshot {
  if (!allowed[job.summary.status].includes(to)) {
    throw new Error("Invalid job transition: " + job.summary.status + " -> " + to);
  }
  return { ...job, summary: { ...job.summary, status: to, updatedAt: now } };
}

export function createSceneJob(
  request: GenerationRequest,
  chunkCount: number,
  now = new Date().toISOString(),
): JobSnapshotV5 {
  if (request.outputSchemaVersion !== 7) throw new Error(RETIRED_LESSON_MESSAGE);
  return JobSnapshotV5Schema.parse({
    schemaVersion: 5,
    request,
    sections: [],
    learningPlan: {
      selectionRepairs: [],
      candidateWindows: chunkCues(request.cues).map((cues, i) => ({
        id: `window-${i}`,
        cueIds: cues.map(c => c.id),
      })),
      batches: [],
    },
    summary: {
      id: request.id,
      sourceTitle: request.source.title,
      provider: request.agent.provider,
      status: "queued",
      completed: 0,
      total: chunkCount + 1 + request.profile.sceneCount,
      createdAt: now,
      updatedAt: now,
    },
  });
}

export function readLearningDocument(value: unknown): LearningDocument {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: number }).schemaVersion !== 7 ||
    !readableLearningExecution((value as { execution?: unknown }).execution)
  )
    throw new Error(RETIRED_LESSON_MESSAGE);
  return validateLearningDocumentV7(value);
}

export type { GenerationRequest, LearningDocument };
