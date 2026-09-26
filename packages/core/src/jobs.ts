import { z } from "zod";
import { chunkCues } from "./subtitles";
import {
  CandidateSceneSchema, GenerationRequestSchema, LearningDocumentSchema, LearningSectionSchema, StudySceneSchema, StudySceneV3Schema,
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

export const JobSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  summary: JobSummarySchema,
  request: GenerationRequestSchema,
  sections: z.array(z.union([StudySceneV3Schema, StudySceneSchema, LearningSectionSchema])),
  scenePlan: ScenePlanSchema.optional(),
}).superRefine((job, ctx) => {
  if (job.summary.id !== job.request.id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Job ID and request ID differ" });
  }
  const completed = job.scenePlan
    ? job.scenePlan.candidateChunks.length + (job.scenePlan.selected ? 1 + job.sections.length : 0)
    : job.sections.length;
  const chunks = chunkCues(job.request.cues).length;
  const expectedTotal = job.scenePlan
    ? chunks + 1 + (job.scenePlan.selected?.length ?? Math.min(job.request.profile.sceneCount, job.request.profile.maxNewVocabulary))
    : job.summary.total;
  if (completed !== job.summary.completed || job.summary.completed > job.summary.total ||
      job.summary.total !== expectedTotal ||
      (job.scenePlan && (job.scenePlan.candidateChunks.length > chunks ||
        (!job.scenePlan.selected && job.sections.length > 0) ||
        (job.scenePlan.selected && job.sections.length > job.scenePlan.selected.length)))) {
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

/** New video lessons checkpoint candidate discovery, global selection, then each scene. */
export function createSceneJob(request: GenerationRequest, chunkCount: number, now = new Date().toISOString()): JobSnapshot {
  const job = createJob(request, chunkCount + 1 + Math.min(request.profile.sceneCount, request.profile.maxNewVocabulary), now);
  return JobSnapshotSchema.parse({ ...job, scenePlan: { candidateChunks: [] } });
}

export function readLearningDocument(value: unknown): LearningDocument {
  if (!value || typeof value !== "object" || !("schemaVersion" in value)) {
    throw new Error("Learning document is missing its schema version");
  }
  const version = (value as { schemaVersion: unknown }).schemaVersion;
  if (version !== 1 && version !== 2 && version !== 3) throw new Error("Unsupported learning document schema version: " + String(version));
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
