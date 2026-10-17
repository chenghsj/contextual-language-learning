import { z } from "zod";
import { SourceSpanSchema } from "./explanations";

export const QualityIssueTypeSchema = z.enum([
  "mistranslation",
  "unsupported_inference",
  "invalid_construction",
  "example_mismatch",
  "uncertainty_bypass",
  "unit_boundary",
  "redundancy",
  "verbosity",
  "style",
]);
export const QualityRiskTypeSchema = z.enum([
  "source_uncertainty",
  "reference_uncertainty",
  "reported_role",
  "context_inference",
  "usage_generalization",
  "construction_example",
  "unit_boundary",
]);
export const QualityRiskSchema = z
  .object({
    type: QualityRiskTypeSchema,
    unitId: z.string().min(1),
    path: z.string().min(1).max(600),
    sourceSpans: z.array(SourceSpanSchema).min(1),
    description: z.string().min(1).max(600),
  })
  .strict();
export const QualityIssueSchema = z
  .object({
    severity: z.enum(["error", "warning"]),
    type: QualityIssueTypeSchema,
    path: z.string().min(1).max(600),
    sourceSpans: z.array(SourceSpanSchema).min(1),
    description: z.string().min(1).max(1000),
  })
  .strict()
  .superRefine((issue, ctx) => {
    const warning = ["redundancy", "verbosity", "style"].includes(issue.type);
    if (warning !== (issue.severity === "warning"))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Issue severity does not match quality policy",
      });
  });
export const QualityReviewSchema = z
  .object({ issues: z.array(QualityIssueSchema).max(100) })
  .strict();
export type QualityRisk = z.infer<typeof QualityRiskSchema>;
export type QualityIssue = z.infer<typeof QualityIssueSchema>;
export type QualityReview = z.infer<typeof QualityReviewSchema>;
/** Host-only evidence. Started-but-unresolved paid requests are not silently replayed. */
export const QualityCheckpointSchema = z
  .object({
    phase: z.enum([
      "review_pending",
      "review_started",
      "repair_pending",
      "repair_started",
      "recheck_pending",
      "recheck_started",
      "accepted",
      "blocked",
    ]),
    repairPatch: z.unknown().optional(),
    originalDraft: z.record(z.unknown()).optional(),
    draft: z.record(z.unknown()),
    inputHash: z.string().length(64),
    draftHash: z.string().length(64),
    risks: z.array(QualityRiskSchema),
    review: QualityReviewSchema.optional(),
    reviewDraftHash: z.string().length(64).optional(),
    reviewHash: z.string().length(64).optional(),
    originalDraftHash: z.string().length(64),
    repairEligible: z.boolean(),
    recheck: QualityReviewSchema.optional(),
    recheckDraftHash: z.string().length(64).optional(),
    recheckHash: z.string().length(64).optional(),
    diagnostic: z.string().max(12000).optional(),
  })
  .strict();
export type QualityCheckpoint = z.infer<typeof QualityCheckpointSchema>;
export const QualityBatchReportSchema = z
  .object({
    batchId: z.string(),
    sceneId: z.string().uuid(),
    draftHash: z.string().length(64),
    reviewIssues: z.array(QualityIssueSchema).optional(),
    reviewed: z.boolean(),
    repaired: z.boolean(),
    issues: z.array(QualityIssueSchema),
  })
  .strict();
