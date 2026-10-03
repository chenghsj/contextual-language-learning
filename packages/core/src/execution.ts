import { z } from "zod";
export const ExecutionCallSchema = z.object({
  step: z.string(),
  provider: z.string(),
  modelId: z.string(),
  at: z.string().datetime(),
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
  inputFingerprint: z.string().length(64),
  provider: z.string(),
  modelId: z.string(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
});
export const ExecutionMetadataSchema = ExecutionIdentitySchema.extend({
  chunkPlan: z.array(z.array(z.string())).max(1000),
  calls: z.array(ExecutionCallSchema).max(2000),
});
export type ExecutionIdentity = z.infer<typeof ExecutionIdentitySchema>;
export type ExecutionMetadata = z.infer<typeof ExecutionMetadataSchema>;
export type ExecutionCall = z.infer<typeof ExecutionCallSchema>;
