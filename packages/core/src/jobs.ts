import { z } from "zod";
import { chunkCues } from "./subtitles";
import {
  CandidateSceneSchema, ContextualSceneSchema, GenerationRequestSchema, LearningDocumentSchema,
  type GenerationRequest, type LearningDocument,
} from "./schema";

export const JobStatusSchema = z.enum(["queued", "running", "waiting", "completed", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSummarySchema = z.object({
  id: z.string().uuid(), sourceTitle: z.string(), provider: z.string(), status: JobStatusSchema,
  completed: z.number().int().nonnegative(), total: z.number().int().positive(),
  phase: z.enum(["analyzing", "selecting", "creating", "saving"]).optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  error: z.string().optional(), documentId: z.string().uuid().optional(),
  ownerPid: z.number().int().positive().optional(),
  publication: z.object({ status: z.enum(["pending", "published", "failed"]),
    location: z.string().optional(), error: z.string().optional() }).optional(),
  backup: z.object({
    status: z.enum(["pending", "uploading", "backed-up", "failed", "conflict", "paused"]),
    accountId: z.string().min(1).max(256), location: z.string().optional(),
    error: z.string().optional(), updatedAt: z.string().datetime(),
  }).optional(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const ScenePlanSchema = z.object({
  candidateChunks: z.array(z.array(CandidateSceneSchema).max(2)).max(100),
  selected: z.array(CandidateSceneSchema).min(1).max(6).optional(),
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;

/** V4 checkpoints always represent candidate selection followed by contextual scenes. */
export const JobSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  summary: JobSummarySchema,
  request: GenerationRequestSchema,
  sections: z.array(ContextualSceneSchema).max(6),
  scenePlan: ScenePlanSchema,
}).superRefine((job, ctx) => {
  if (job.summary.id !== job.request.id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Job ID and request ID differ" });
  }
  const chunks = chunkCues(job.request.cues).length;
  const completed = job.scenePlan.candidateChunks.length +
    (job.scenePlan.selected ? 1 + job.sections.length : 0);
  const expectedTotal = chunks + 1 +
    (job.scenePlan.selected?.length ?? job.request.profile.sceneCount);
  if (completed !== job.summary.completed || job.summary.total !== expectedTotal ||
      job.scenePlan.candidateChunks.length > chunks ||
      (!job.scenePlan.selected && job.sections.length > 0) ||
      (job.scenePlan.selected && job.sections.length > job.scenePlan.selected.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Job checkpoint is inconsistent" });
  }
  if (job.summary.status === "completed" &&
      (job.summary.completed !== job.summary.total || job.summary.documentId !== job.summary.id)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Completed job must reference its document" });
  }
});
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;

const allowed: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"], running: ["waiting", "completed", "failed", "cancelled"],
  waiting: ["queued", "cancelled"], failed: ["queued", "cancelled"],
  completed: [], cancelled: ["queued"],
};

export function transitionJob(job: JobSnapshot, to: JobStatus, now = new Date().toISOString()): JobSnapshot {
  if (!allowed[job.summary.status].includes(to)) {
    throw new Error("Invalid job transition: " + job.summary.status + " -> " + to);
  }
  return { ...job, summary: { ...job.summary, status: to, updatedAt: now } };
}

export function createSceneJob(request: GenerationRequest, chunkCount: number, now = new Date().toISOString()): JobSnapshot {
  return JobSnapshotSchema.parse({
    schemaVersion: 2, request, sections: [], scenePlan: { candidateChunks: [] },
    summary: {
      id: request.id, sourceTitle: request.source.title, provider: request.agent.provider,
      status: "queued", completed: 0, total: chunkCount + 1 + request.profile.sceneCount,
      createdAt: now, updatedAt: now,
    },
  });
}

export function readLearningDocument(value: unknown): LearningDocument {
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== 4) {
    throw new Error("Unsupported learning document schema version");
  }
  return LearningDocumentSchema.parse(value);
}

export type { GenerationRequest, LearningDocument };
