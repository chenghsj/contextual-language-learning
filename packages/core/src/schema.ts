import { ExecutionMetadataSchema, ExecutionIdentitySchema } from "./execution";
import { AnalysisRangeSchema } from "./analysis-range";
import { z } from "zod";
import { isPiProviderId } from "./pi-providers";
import { LEARNING_LANGUAGES, EXPLANATION_LANGUAGES } from "./languages";
import { ExplanationTypeSchema, SourceSpanSchema, SentenceChunkSchema } from "./explanations";
import { ThinkingLevelSchema } from "./thinking";
import { CustomModelIdSchema } from "./custom-model";

export const SubtitleRubySchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  reading: z.string().min(1).max(200),
  position: z.enum(["over", "under"]),
});
export type SubtitleRuby = z.infer<typeof SubtitleRubySchema>;

export const SubtitleCueSchema = z
  .object({
    id: z.string().min(1).max(80),
    startMs: z.number().int().nonnegative().nullable(),
    endMs: z.number().int().nonnegative().nullable(),
    originalText: z.string().min(1).max(1500),
    ruby: z.array(SubtitleRubySchema).min(1).max(100).optional(),
  })
  .refine(
    cue =>
      !cue.ruby ||
      cue.ruby.every(
        (item, index, items) =>
          item.start < item.end &&
          item.end <= cue.originalText.length &&
          (index === 0 || item.start >= items[index - 1].end),
      ),
    {
      message: "Subtitle ruby ranges must be ordered, nonoverlapping source ranges",
    },
  )
  .refine(cue => cue.startMs === null || cue.endMs === null || cue.endMs >= cue.startMs, {
    message: "Subtitle end must not precede start",
  });
export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;

export const SourceSchema = z.object({
  platform: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(2048).optional(),
});
export type VideoSource = z.infer<typeof SourceSchema>;

export const LearningProfileSchema = z.object({
  targetLanguage: z.enum(LEARNING_LANGUAGES),
  instructionLanguage: z.enum(EXPLANATION_LANGUAGES),
  level: z.string().min(1).max(12),
  sceneCount: z.union([z.literal(2), z.literal(4), z.literal(6)]),
  contextualExampleCount: z.number().int().min(1).max(3),
  enabledExplanations: z.array(ExplanationTypeSchema).max(6).optional(),
  emphasizedExplanations: z.array(ExplanationTypeSchema).max(6).optional(),
});
export type LearningProfile = z.infer<typeof LearningProfileSchema>;

export { ThinkingLevelSchema, type ThinkingLevel } from "./thinking";

export const AgentSettingsSchema = z
  .object({
    provider: z
      .string()
      .refine((value): boolean => isPiProviderId(value), "Unsupported Pi provider"),
    modelId: z.string().max(120),
    thinkingLevel: ThinkingLevelSchema.optional(),
    /** Explicit user selection; absent for normal catalog models. */
    customModel: z.boolean().optional(),
  })
  .strict()
  .refine(
    value => {
      if (!value.customModel) return true;
      const parsed = CustomModelIdSchema.safeParse(value.modelId);
      return parsed.success && parsed.data === value.modelId;
    },
    {
      message: "A custom model requires a valid model ID.",
      path: ["modelId"],
    },
  );
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const DestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), directory: z.string().min(1).max(2048).optional() }),
  z.object({ kind: z.literal("drive"), accountId: z.string().min(1).max(256) }),
]);
export type Destination = z.infer<typeof DestinationSchema>;

export const BackupSettingsSchema = z
  .object({
    enabled: z.boolean(),
    accountId: z.string().min(1).max(256).optional(),
  })
  .refine(
    value => !value.enabled || !!value.accountId,
    "A connected Google account is required for backup",
  );
export type BackupSettings = z.infer<typeof BackupSettingsSchema>;

export const DriveAccountSchema = z.object({
  id: z.string().min(1).max(256),
  email: z.string().email().max(320),
});
export type DriveAccount = z.infer<typeof DriveAccountSchema>;

export interface LessonSummary {
  schemaVersion?: 7;
  pointCount?: number;
  reusableItemCount?: number;
  documentId: string;
  title: string;
  createdAt: string;
  sourceKey: string;
  targetLanguage: string;
  level: string;
  sceneCount?: number;
  expressionCount?: number;
  sceneIds?: string[];
  backup?: { status: string; accountId: string; location?: string; error?: string };
}
export interface DriveLessonSummary {
  schemaVersion?: 7;
  pointCount?: number;
  reusableItemCount?: number;
  documentId: string;
  title: string;
  createdAt: string;
  sourceKey?: string;
  accountId: string;
  url: string;
  targetLanguage?: string;
  level?: string;
  sceneCount?: number;
  expressionCount?: number;
}

export const DuplicateMatchSchema = z.object({
  documentId: z.string().uuid(),
  title: z.string(),
  createdAt: z.string().datetime(),
  destination: z.string(),
  exactSettings: z.boolean(),
  local: z.boolean(),
  url: z.string().url().optional(),
  jobStatus: z.string().optional(),
});
export type DuplicateMatch = z.infer<typeof DuplicateMatchSchema>;

export const GenerationRequestSchema = z
  .object({
    id: z.string().uuid(),
    outputSchemaVersion: z.literal(7).optional(),
    source: SourceSchema,
    profile: LearningProfileSchema,
    agent: AgentSettingsSchema,
    destination: DestinationSchema.optional(),
    backup: BackupSettingsSchema.optional(),
    analysisRange: AnalysisRangeSchema.optional(),
    cues: z.array(SubtitleCueSchema).min(1).max(3000),
  })
  .refine(
    request => request.cues.reduce((sum, cue) => sum + cue.originalText.length, 0) <= 220_000,
    {
      message: "Transcript exceeds the 220,000-character limit; select a shorter section",
    },
  );
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

export const StudyTranslationSchema = z.object({
  cueId: z.string().min(1),
  text: z.string().min(1).max(700),
});
/** Segments concatenate to the unchanged source text; reading is omitted when uncertain. */
export const PronunciationSegmentSchema = z.object({
  text: z.string().min(1).max(500),
  reading: z.string().min(1).max(200).optional(),
});
export type PronunciationSegment = z.infer<typeof PronunciationSegmentSchema>;
export const CuePronunciationSchema = z.object({
  cueId: z.string().min(1).max(80),
  segments: z.array(PronunciationSegmentSchema).min(1).max(100),
});
const DocumentCommonSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  source: SourceSchema,
  profile: LearningProfileSchema,
  generation: AgentSettingsSchema,
  execution: ExecutionMetadataSchema.optional(),
  analysisRange: AnalysisRangeSchema.optional(),
  cues: z.array(SubtitleCueSchema),
});
/** Calibrated playback windows never replace the canonical subtitle timestamps. */
export const PlaybackOverrideSchema = z
  .object({
    startMs: z.number().int().min(0).max(43_200_000),
    endMs: z.number().int().min(0).max(43_200_000),
  })
  .refine(range => range.endMs - range.startMs >= 250 && range.endMs - range.startMs <= 600_000, {
    message: "Playback duration must be between 0.25s and 10min",
  });
export type PlaybackOverride = z.infer<typeof PlaybackOverrideSchema>;
const Ref = z.string().min(1).max(240);
const Refs = z.array(Ref);
export const LearningPointSchema = z
  .object({
    id: Ref,
    utteranceIds: Refs.min(1),
    category: ExplanationTypeSchema,
    presentation: z.enum(["core", "extended"]).optional(),
    title: z.string().min(1).max(200),
    sourceCueIds: Refs.min(1),
    contextCueIds: Refs,
    explanation: z.string().min(1).max(6000),
    sourceSpans: z.array(SourceSpanSchema).min(1),
  })
  .strict();
export const ReusableItemSchema = z
  .object({
    id: Ref,
    pointIds: Refs.min(1),
    kind: z.enum(["expression", "frame"]),
    sourceForms: z
      .array(
        z
          .object({
            cueIds: Refs.min(1),
            sourceSpans: z.array(SourceSpanSchema).min(1),
            text: z.string().min(1).max(1500),
          })
          .strict(),
      )
      .min(1),
    pattern: z.string().min(1).max(500).optional(),
    examples: z
      .array(
        z
          .object({
            origin: z.literal("ai"),
            situation: z.string().min(1).max(600),
            dialogue: z
              .array(
                z
                  .object({
                    text: z.string().min(1).max(500),
                    translation: z.string().min(1).max(700),
                    pronunciation: z.array(PronunciationSegmentSchema).min(1).max(100).optional(),
                  })
                  .strict(),
              )
              .min(2)
              .max(3),
            targetLineIndex: z.number().int().min(0).max(2),
            targetText: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict()
  .superRefine((item, ctx) => {
    if ((item.kind === "frame") !== (item.pattern !== undefined))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only a frame requires a separate pattern",
      });
  });
export const UtteranceTeachingSchema = z
  .object({
    id: Ref,
    meaning: z.string().max(2000),
    contextExplanation: z.string().max(3000),
    contextCueIds: Refs,
    decision: z.enum(["explained", "basic_only"]),
    pointIds: Refs,
    chunks: z
      .array(SentenceChunkSchema.omit({ reusablePattern: true }).extend({ id: Ref }).strict())
      .optional(),
  })
  .strict();
export const SourceUtteranceSchema = z
  .object({ id: Ref, cueIds: Refs.min(1), sourceSpans: z.array(SourceSpanSchema).min(1) })
  .strict();
export const LearningUtteranceSchema = UtteranceTeachingSchema.extend({
  cueIds: Refs.min(1),
  sourceSpans: z.array(SourceSpanSchema).min(1),
});
export const LearningSceneV7Schema = z
  .object({
    id: z.string().uuid(),
    cueIds: Refs.min(1),
    contextCueIds: Refs,
    startMs: z.number().int().nonnegative().nullable(),
    endMs: z.number().int().nonnegative().nullable(),
    title: z.string().min(1).max(180),
    context: z.object({ text: z.string().min(1).max(3000), evidenceCueIds: Refs }).strict(),
    translations: z.array(StudyTranslationSchema).min(1),
    pronunciations: z.array(CuePronunciationSchema).optional(),
    utterances: z.array(LearningUtteranceSchema).min(1),
  })
  .strict();
export const LearningDocumentV7Schema = DocumentCommonSchema.extend({
  schemaVersion: z.literal(7),
  sections: z.array(LearningSceneV7Schema).min(1).max(6),
  points: z.array(LearningPointSchema),
  reusableItems: z.array(ReusableItemSchema),
  playbackOverrides: z.record(z.string().min(1).max(80), PlaybackOverrideSchema).optional(),
  scenePlaybackOverrides: z.record(z.string().uuid(), PlaybackOverrideSchema).optional(),
}).strict();
export const LearningDocumentSchema = LearningDocumentV7Schema;
export type LearningDocumentV7 = z.infer<typeof LearningDocumentV7Schema>;
export type LearningDocument = z.infer<typeof LearningDocumentSchema>;
export type LearningPoint = z.infer<typeof LearningPointSchema>;
export type ReusableItem = z.infer<typeof ReusableItemSchema>;
export type LearningSceneV7 = z.infer<typeof LearningSceneV7Schema>;
export type SourceUtterance = z.infer<typeof SourceUtteranceSchema>;
export const LEARNING_POINTS_WORKFLOW_VERSION = "learning-points-v7-1";
export const LEARNING_POINTS_PROMPT_VERSION = "learning-points-prompts-20";
export const LANGUAGE_STRATEGY_VERSION = "learning-language-strategies-5";
export const QUALITY_STRATEGY_VERSION = "program-validation-3";
export const LEVEL_STRATEGY_VERSION = "learning-level-strategies-1";

export const RETIRED_LESSON_MESSAGE = "此教材版本已停止支援，請重新生成";
export function currentLearningExecution(value: unknown): boolean {
  const parsed = ExecutionIdentitySchema.safeParse(value);
  if (!parsed.success || !parsed.data.provider || !parsed.data.modelId) return false;
  const e = parsed.data;
  return (
    e.workflowVersion === LEARNING_POINTS_WORKFLOW_VERSION &&
    e.promptVersion === LEARNING_POINTS_PROMPT_VERSION &&
    e.schemaVersion === "7" &&
    e.languageStrategyVersion === LANGUAGE_STRATEGY_VERSION &&
    e.levelStrategyVersion === LEVEL_STRATEGY_VERSION &&
    e.qualityStrategyVersion === QUALITY_STRATEGY_VERSION
  );
}

/** Compatible V7 files remain readable; new generation always uses the current identity. */
export function readableLearningExecution(value: unknown): boolean {
  if (currentLearningExecution(value)) return true;
  const parsed = ExecutionIdentitySchema.safeParse(value);
  if (!parsed.success || !parsed.data.provider || !parsed.data.modelId) return false;
  const e = parsed.data;
  return (
    e.workflowVersion === LEARNING_POINTS_WORKFLOW_VERSION &&
    e.schemaVersion === "7" &&
    e.levelStrategyVersion === LEVEL_STRATEGY_VERSION &&
    ((e.languageStrategyVersion === "learning-language-strategies-5" &&
      ((e.qualityStrategyVersion === "program-validation-2" &&
        e.promptVersion === "learning-points-prompts-18") ||
        (e.qualityStrategyVersion === "program-validation-3" &&
          e.promptVersion === "learning-points-prompts-19"))) ||
      (e.languageStrategyVersion === "learning-language-strategies-4" &&
        ((e.qualityStrategyVersion === "learning-quality-1" &&
          ["learning-points-prompts-12", "learning-points-prompts-13"].includes(e.promptVersion)) ||
          (e.qualityStrategyVersion === "program-validation-1" &&
            e.promptVersion === "learning-points-prompts-14") ||
          (e.qualityStrategyVersion === "program-validation-2" &&
            [
              "learning-points-prompts-15",
              "learning-points-prompts-16",
              "learning-points-prompts-17",
            ].includes(e.promptVersion)))))
  );
}
