import { z } from "zod";
import {
  AgentSettingsSchema,
  SourceSchema,
  SubtitleCueSchema,
  DestinationSchema,
  BackupSettingsSchema,
} from "./schema";
import { AnalysisRangeSchema } from "./analysis-range";
import { ExecutionMetadataSchema, ExecutionCallSchema } from "./execution";
import { JobSummarySchema } from "./jobs";
export const CustomGenerationRequestSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("custom"),
    source: SourceSchema,
    agent: AgentSettingsSchema,
    prompt: z.string().trim().min(1).max(20000),
    context: z.object({ subtitles: z.boolean(), title: z.boolean() }),
    analysisRange: AnalysisRangeSchema.optional(),
    cues: z.array(SubtitleCueSchema).min(1).max(3000),
    destination: DestinationSchema.optional(),
    backup: BackupSettingsSchema.optional(),
    previousDocumentId: z.string().uuid().optional(),
  })
  .refine(
    request => request.cues.reduce((sum, cue) => sum + cue.originalText.length, 0) <= 220000,
    "Transcript exceeds the 220,000-character limit; select a shorter section",
  );
export const CustomNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(["segment", "merge"]),
  level: z.number().int().nonnegative(),
  inputs: z.array(z.string()),
  cueIds: z.array(z.string()),
  output: z.string().min(1).max(200000).optional(),
  call: ExecutionCallSchema.optional(),
});
export const CustomJobSnapshotSchema = z
  .object({
    schemaVersion: z.literal("custom-v1"),
    historyHidden: z.boolean().optional(),
    request: CustomGenerationRequestSchema,
    summary: JobSummarySchema,
    execution: ExecutionMetadataSchema,
    nodes: z.array(CustomNodeSchema).min(1).max(1000),
    inputBudget: z.number().int().positive(),
    outputByteLimit: z.number().int().positive(),
  })
  .superRefine((job, ctx) => {
    const done = job.nodes.filter(node => node.output !== undefined).length;
    const seen = new Set<string>();
    for (const node of job.nodes) {
      if (seen.has(node.id) || node.inputs.some(id => !seen.has(id)))
        ctx.addIssue({ code: "custom", message: "Invalid custom node dependency plan" });
      seen.add(node.id);
    }
    const segments = job.nodes.filter(node => node.kind === "segment");
    if (
      JSON.stringify(segments.map(node => node.cueIds)) !== JSON.stringify(job.execution.chunkPlan)
    )
      ctx.addIssue({
        code: "custom",
        message: "Custom segment plan differs from frozen execution",
      });
    const sourceIds = new Set(job.request.cues.map(cue => cue.id));
    for (const node of job.nodes) {
      if (
        node.cueIds.some(id => !sourceIds.has(id)) ||
        (node.kind === "segment" && node.inputs.length > 0) ||
        (node.kind === "merge" && (!node.inputs.length || node.cueIds.length > 0))
      )
        ctx.addIssue({ code: "custom", message: "Invalid custom source plan" });
      if (node.output && node.inputs.some(id => !job.nodes.find(item => item.id === id)?.output))
        ctx.addIssue({ code: "custom", message: "Custom checkpoint missing completed dependency" });
    }
    if (
      job.summary.id !== job.request.id ||
      job.summary.completed !== done ||
      job.summary.total !== job.nodes.length
    )
      ctx.addIssue({ code: "custom", message: "Custom checkpoint progress differs from plan" });
  });
export const CustomDocumentSchema = z.object({
  schemaVersion: z.literal("custom-v1"),
  kind: z.literal("custom"),
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
  request: CustomGenerationRequestSchema,
  execution: ExecutionMetadataSchema,
  markdown: z.string().trim().min(1).max(200000),
  previousDocumentId: z.string().uuid().optional(),
});
export const CustomContentSummarySchema = z.object({
  kind: z.literal("custom"),
  documentId: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().datetime(),
  sourceTitle: z.string(),
  backup: JobSummarySchema.shape.backup.optional(),
});
export type CustomGenerationRequest = z.infer<typeof CustomGenerationRequestSchema>;
export type CustomNode = z.infer<typeof CustomNodeSchema>;
export type CustomJobSnapshot = z.infer<typeof CustomJobSnapshotSchema>;
export type CustomDocument = z.infer<typeof CustomDocumentSchema>;
export type CustomContentSummary = z.infer<typeof CustomContentSummarySchema>;
