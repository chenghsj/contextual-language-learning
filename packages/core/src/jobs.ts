import { z } from "zod";
import {
  GenerationRequestSchema, LearningDocumentSchema, LearningSectionSchema,
  type GenerationRequest, type LearningDocument, type LearningSection,
} from "./schema";

export const JobStatusSchema = z.enum(["queued", "running", "waiting", "completed", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSummarySchema = z.object({
  id: z.string().uuid(),
  sourceTitle: z.string(),
  provider: z.string(),
  status: JobStatusSchema,
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().optional(),
  documentId: z.string().uuid().optional(),
  ownerPid: z.number().int().positive().optional(),
  publication: z.object({ status: z.enum(["pending", "published", "failed"]), location: z.string().optional(), error: z.string().optional() }).optional(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  summary: JobSummarySchema,
  request: GenerationRequestSchema,
  sections: z.array(LearningSectionSchema),
}).superRefine((job, ctx) => {
  if (job.summary.id !== job.request.id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Job ID and request ID differ" });
  }
  if (job.sections.length !== job.summary.completed || job.summary.completed > job.summary.total) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Job checkpoint is inconsistent" });
  }
  if (job.summary.status === "completed" &&
    (job.summary.completed !== job.summary.total || !job.summary.documentId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Completed job must reference a complete document" });
  }
});
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;

const allowed: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["waiting", "completed", "failed", "cancelled"],
  waiting: ["queued", "cancelled"],
  failed: ["queued", "cancelled"],
  completed: [],
  cancelled: [],
};

export function transitionJob(job: JobSnapshot, to: JobStatus, now = new Date().toISOString()): JobSnapshot {
  if (!allowed[job.summary.status].includes(to)) {
    throw new Error("Invalid job transition: " + job.summary.status + " -> " + to);
  }
  return { ...job, summary: { ...job.summary, status: to, updatedAt: now } };
}

export function createJob(request: GenerationRequest, total: number, now = new Date().toISOString()): JobSnapshot {
  return JobSnapshotSchema.parse({
    schemaVersion: 1, request, sections: [],
    summary: {
      id: request.id, sourceTitle: request.source.title, provider: request.agent.provider,
      status: "queued", completed: 0, total, createdAt: now, updatedAt: now,
    },
  });
}

export function readLearningDocument(value: unknown): LearningDocument {
  if (!value || typeof value !== "object" || !("schemaVersion" in value)) {
    throw new Error("Learning document is missing its schema version");
  }
  const version = (value as { schemaVersion: unknown }).schemaVersion;
  if (version !== 1) throw new Error("Unsupported learning document schema version: " + String(version));
  return LearningDocumentSchema.parse(value);
}

export const StudyProgressSchema = z.object({
  schemaVersion: z.literal(1),
  documentId: z.string().uuid(),
  completedSectionIds: z.array(z.string().uuid()),
  reviewedExpressions: z.array(z.string()),
  updatedAt: z.string().datetime(),
});
export type StudyProgress = z.infer<typeof StudyProgressSchema>;
export type { GenerationRequest, LearningDocument, LearningSection };
