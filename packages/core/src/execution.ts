import { z } from "zod";
import { QualityBatchReportSchema } from "./quality";
import { BillingKindSchema } from "./usage-estimate";
/** Host-authored processing evidence, never model-authored teaching content. */
export const PronunciationDiagnosticSchema = z
  .object({
    id: z.string().min(1).max(600),
    batchId: z.string().min(1).max(240),
    sceneId: z.string().uuid(),
    path: z.string().min(1).max(400),
    cueId: z.string().optional(),
    itemId: z.string().optional(),
    exampleIndex: z.number().int().nonnegative().optional(),
    lineIndex: z.number().int().nonnegative().optional(),
    segmentIndex: z.number().int().nonnegative().optional(),
    code: z.enum([
      "reading_normalized",
      "invalid_reading",
      "empty_reading",
      "empty_annotation",
      "annotation_alignment",
    ]),
    action: z.enum(["normalized", "pending", "repaired", "omitted"]),
  })
  .strict();
export type PronunciationDiagnostic = z.infer<typeof PronunciationDiagnosticSchema>;
export function pronunciationMissingCount(diagnostics: readonly PronunciationDiagnostic[] = []) {
  return new Set(diagnostics.filter(d => d.action === "omitted").map(d => d.batchId + ":" + d.path))
    .size;
}
export const ExecutionCallSchema = z.object({
  step: z.string(),
  provider: z.string(),
  modelId: z.string(),
  billing: BillingKindSchema.optional(),
  at: z.string().datetime(),
  outputTokenBudget: z.number().int().positive().optional(),
  stopReason: z.string().max(40).optional(),
  durationMs: z.number().nonnegative().optional(),
  retries: z
    .array(
      z.object({
        attempt: z.number().int().min(1).max(2),
        delayMs: z.number().nonnegative(),
        reason: z.string().max(500),
      }),
    )
    .max(2)
    .optional(),
  usage: z
    .object({
      input: z.number().nonnegative().optional(),
      output: z.number().nonnegative().optional(),
      reasoning: z.number().nonnegative().optional(),
      cacheRead: z.number().nonnegative().optional(),
      cacheWrite: z.number().nonnegative().optional(),
    })
    .optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});
export const ExecutionIdentitySchema = z.object({
  workflowVersion: z.string().max(80),
  promptVersion: z.string().max(80),
  schemaVersion: z.string().max(80),
  languageStrategyVersion: z.string().max(80).optional(),
  levelStrategyVersion: z.string().max(80).optional(),
  qualityStrategyVersion: z.string().max(80).optional(),
  inputFingerprint: z.string().length(64),
  provider: z.string(),
  modelId: z.string(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});
export const ExecutionMetadataSchema = ExecutionIdentitySchema.extend({
  previousExecution: ExecutionIdentitySchema.optional(),
  qualityReports: z.array(QualityBatchReportSchema).max(1000).optional(),
  chunkPlan: z.array(z.array(z.string())).max(1000),
  calls: z.array(ExecutionCallSchema).max(2000),
  pronunciationDiagnostics: z.array(PronunciationDiagnosticSchema).max(20000).optional(),
});
export type ExecutionIdentity = z.infer<typeof ExecutionIdentitySchema>;
export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;
export type ExecutionCall = z.infer<typeof ExecutionCallSchema>;
