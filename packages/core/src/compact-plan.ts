import { z } from "zod";
import {
  LearningSceneV7Schema,
  LearningPointSchema,
  ReusableItemSchema,
  SourceUtteranceSchema,
  type GenerationRequest,
  type LearningDocument,
} from "./schema";
import {
  PronunciationDiagnosticSchema,
  pronunciationMissingCount,
  type ExecutionMetadata,
} from "./execution";
import {
  validateLearningDocumentV7,
  contiguousIds,
  validateReferences,
  uniqueIds,
} from "./learning-points";
import { validateUnitCoverage } from "./source-units";
import { QualityIssueSchema } from "./quality";

export const COMPACT_SCENE_STRATEGY_VERSION = "compact-scenes-1";
export const CompactSceneSourceSchema = z
  .object({
    id: z.string().uuid(),
    dialogueCueIds: z.array(z.string()).min(1),
    contextCueIds: z.array(z.string()),
    learningValue: z.string().min(1).max(1500),
  })
  .strict();
export const CompactSceneResultSchema = z
  .object({
    sourceUnits: z.array(SourceUtteranceSchema).min(1),
    section: LearningSceneV7Schema,
    points: z.array(LearningPointSchema),
    reusableItems: z.array(ReusableItemSchema),
    diagnostics: z.array(PronunciationDiagnosticSchema),
  })
  .strict();
export const CompactQualityReviewSchema = z
  .object({
    issues: z.array(QualityIssueSchema).max(100),
    patches: z
      .array(z.object({ path: z.string().min(1).max(600), value: z.unknown() }).strict())
      .max(100),
  })
  .strict();
export type CompactQualityReview = z.infer<typeof CompactQualityReviewSchema>;
const WorkState = z.object({
  pendingText: z.string().optional(),
  repairAttempted: z.boolean().optional(),
  jsonRepairAttempted: z.boolean().optional(),
  issue: z.string().optional(),
  outputTokenBudget: z.number().int().positive().optional(),
  truncated: z.boolean().optional(),
  capacityRetried: z.boolean().optional(),
  recoveredPreviousOutput: z.boolean().optional(),
  previousOutputs: z
    .array(z.object({ text: z.string(), issue: z.string() }))
    .max(2)
    .optional(),
  jsonNormalization: z
    .array(
      z.enum([
        "stray_object_backslash",
        "span_number_quote",
        "unquoted_reading_key",
        "target_line_index_key_quote",
      ]),
    )
    .max(4)
    .optional(),
});
export const CompactPlanSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    windows: z.array(
      WorkState.extend({
        id: z.string(),
        cueIds: z.array(z.string()).min(1),
        candidates: z.array(CompactSceneSourceSchema).optional(),
      }).strict(),
    ),
    selection: WorkState.optional(),
    scenes: z
      .array(
        WorkState.extend({
          source: CompactSceneSourceSchema,
          result: CompactSceneResultSchema.optional(),
        }).strict(),
      )
      .max(6)
      .optional(),
    reconciliation: WorkState.extend({
      pointGroups: z.array(z.array(z.string()).min(2)).optional(),
      itemGroups: z.array(z.array(z.string()).min(2)).optional(),
      qualityReview: CompactQualityReviewSchema.optional(),
      qualityDraftHash: z.string().length(64).optional(),
      qualityOriginalResults: z.array(CompactSceneResultSchema).max(6).optional(),
      qualityRecheck: WorkState.extend({ issues: z.array(QualityIssueSchema).max(100).optional() })
        .strict()
        .optional(),
      qualityAccepted: z.boolean().optional(),
    })
      .strict()
      .optional(),
  })
  .strict();
export type CompactPlan = z.infer<typeof CompactPlanSchema>;
export type CompactSceneResult = z.infer<typeof CompactSceneResultSchema>;
export function compactProgress(plan: CompactPlan, sceneLimit: number) {
  const ready = plan.scenes?.filter(s => s.result) ?? [];
  const needsRecheck = plan.reconciliation?.qualityReview?.issues.some(i => i.severity === "error")
    ? 1
    : 0;
  return {
    completed:
      plan.windows.filter(w => w.candidates !== undefined).length +
      (plan.scenes ? 1 : 0) +
      ready.length +
      (plan.reconciliation?.pointGroups !== undefined ? 1 : 0) +
      (needsRecheck && plan.reconciliation?.qualityRecheck?.issues !== undefined ? 1 : 0),
    total: plan.windows.length + 2 + (plan.scenes?.length ?? sceneLimit) + needsRecheck,
    readySceneIds: ready.map(s => s.source.id),
    previewRevision: plan.revision,
    selectedSceneCount: plan.scenes?.length,
    pronunciationMissingCount: pronunciationMissingCount(ready.flatMap(s => s.result!.diagnostics)),
  };
}
export function compactDocument(
  request: GenerationRequest,
  execution: ExecutionMetadata | undefined,
  createdAt: string,
  plan: CompactPlan,
): LearningDocument | null {
  const results = (plan.scenes ?? []).flatMap(s => (s.result ? [s.result] : []));
  if (!results.length) return null;
  return validateLearningDocumentV7({
    schemaVersion: 7,
    id: request.id,
    createdAt,
    source: request.source,
    profile: request.profile,
    cues: request.cues,
    generation: {
      ...request.agent,
      ...(execution ? { provider: execution.provider, modelId: execution.modelId } : {}),
    },
    execution: execution
      ? {
          ...execution,
          ...(plan.reconciliation?.pointGroups !== undefined
            ? {
                pointEquivalenceGroups: plan.reconciliation.pointGroups,
                itemEquivalenceGroups: plan.reconciliation.itemGroups ?? [],
              }
            : {}),
          pronunciationDiagnostics: results.flatMap(r => r.diagnostics),
        }
      : undefined,
    analysisRange: request.analysisRange,
    sections: results.map(r => r.section),
    points: results.flatMap(r => r.points),
    reusableItems: results.flatMap(r => r.reusableItems),
  });
}
export function compactCheckpointIssues(
  plan: CompactPlan,
  request: GenerationRequest,
  execution?: ExecutionMetadata,
): string[] {
  const issues: string[] = [];
  try {
    uniqueIds(
      plan.windows.map(w => w.id),
      "Duplicate compact window identity",
    );
    if (execution) {
      const ceiling = Math.min(execution.maxOutputTokens, Math.floor(execution.contextWindow / 4));
      const states = [
        ...plan.windows,
        ...(plan.scenes ?? []),
        ...(plan.selection ? [plan.selection] : []),
        ...(plan.reconciliation ? [plan.reconciliation] : []),
        ...(plan.reconciliation?.qualityRecheck ? [plan.reconciliation.qualityRecheck] : []),
      ];
      if (states.some(s => (s.outputTokenBudget ?? 0) > ceiling))
        throw new Error("Compact budget exceeds frozen capacity");
    }
    if (
      JSON.stringify(plan.windows.flatMap(w => w.cueIds)) !==
      JSON.stringify(request.cues.map(c => c.id))
    )
      throw new Error("Compact windows must partition frozen source");
    const pool = plan.windows.flatMap(w => w.candidates ?? []);
    uniqueIds(
      pool.map(s => s.id),
      "Duplicate compact candidate identity",
    );
    for (const w of plan.windows)
      for (const c of w.candidates ?? []) {
        contiguousIds(c.dialogueCueIds, request.cues);
        if (!w.cueIds.includes(c.dialogueCueIds[0]))
          throw new Error("Compact candidate starts outside its window");
        validateReferences(
          c.contextCueIds,
          request.cues.map(c => c.id),
          "Invalid compact context",
        );
      }
    if (plan.scenes) {
      if (!plan.scenes.length || plan.scenes.length > request.profile.sceneCount)
        throw new Error("Invalid compact scene count");
      uniqueIds(
        plan.scenes.map(s => s.source.id),
        "Duplicate compact selection",
      );
      uniqueIds(
        plan.scenes.flatMap(s => s.source.dialogueCueIds),
        "Overlapping compact scenes",
      );
      let previous = -1;
      for (const s of plan.scenes) {
        if (!pool.some(c => JSON.stringify(c) === JSON.stringify(s.source)))
          throw new Error("Compact selection differs from candidates");
        const at = request.cues.findIndex(c => c.id === s.source.dialogueCueIds[0]);
        if (at <= previous) throw new Error("Compact scenes must follow source order");
        previous = at;
        if (s.result) {
          validateUnitCoverage(s.result.sourceUnits, s.source.dialogueCueIds, request.cues);
          if (
            JSON.stringify(s.result.sourceUnits) !==
            JSON.stringify(
              s.result.section.utterances.map(({ id, cueIds, sourceSpans }) => ({
                id,
                cueIds,
                sourceSpans,
              })),
            )
          )
            throw new Error("Compact source units differ from completed teaching");
          if (s.pendingText !== undefined)
            throw new Error("Completed compact scene still has pending output");
          if (
            s.result.section.id !== s.source.id ||
            JSON.stringify(s.result.section.cueIds) !== JSON.stringify(s.source.dialogueCueIds)
          )
            throw new Error("Compact result differs from frozen source");
          if (s.result.diagnostics.some(d => d.sceneId !== s.source.id || d.action === "pending"))
            throw new Error("Invalid final compact diagnostics");
        }
      }
    }
    if (
      plan.reconciliation?.pointGroups !== undefined &&
      (!plan.scenes || plan.scenes.some(s => !s.result))
    )
      throw new Error("Reconciliation requires all scenes");
    const review = plan.reconciliation;
    if (review?.qualityReview) {
      if (
        !execution?.compactQualityVersion ||
        review.pointGroups === undefined ||
        !review.qualityDraftHash
      )
        throw new Error("Quality review requires a frozen strategy and reconciliation");
      if (review.qualityReview.patches.length) {
        if (
          !review.qualityOriginalResults ||
          review.qualityOriginalResults.length !== plan.scenes?.length
        )
          throw new Error("Quality repair requires the original scene results");
        for (const [i, original] of review.qualityOriginalResults.entries())
          if (
            JSON.stringify(original.sourceUnits) !==
            JSON.stringify(plan.scenes![i].result?.sourceUnits)
          )
            throw new Error("Quality repair cannot change frozen source units");
      }
    }
    if (review?.qualityAccepted) {
      if (!review.qualityReview) throw new Error("Accepted quality requires review evidence");
      const errors = review.qualityReview.issues.filter(i => i.severity === "error");
      if (
        errors.length &&
        (!review.qualityReview.patches.length ||
          review.qualityRecheck?.issues === undefined ||
          review.qualityRecheck.issues.some(i => i.severity === "error"))
      )
        throw new Error("Unresolved quality errors cannot be accepted");
    }
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }
  return issues;
}
