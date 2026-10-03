import { ExecutionMetadataSchema } from "./execution";
import { AnalysisRangeSchema } from "./analysis-range";
import { z } from "zod";
import { isPiProviderId } from "./pi-providers";
import { LEARNING_LANGUAGES, EXPLANATION_LANGUAGES } from "./languages";

export const SubtitleCueSchema = z
  .object({
    id: z.string().min(1).max(80),
    startMs: z.number().int().nonnegative().nullable(),
    endMs: z.number().int().nonnegative().nullable(),
    originalText: z.string().min(1).max(1500),
  })
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
});
export type LearningProfile = z.infer<typeof LearningProfileSchema>;

export const ThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const AgentSettingsSchema = z
  .object({
    provider: z
      .string()
      .refine((value): boolean => isPiProviderId(value), "Unsupported Pi provider"),
    modelId: z.string().max(120),
    thinkingLevel: ThinkingLevelSchema.optional(),
  })
  .strict();
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

/** Selection IDs and timestamps are resolved against the real transcript, never invented by the model. */
export const CandidateContentSchema = z.object({
  cueIds: z.array(z.string().min(1)).min(1).max(10),
  focusExpressions: z.array(z.string().min(1).max(160)).min(1).max(2),
  learningGoal: z.string().min(1).max(250),
});
export const CandidateSceneSchema = CandidateContentSchema.extend({
  id: z.string().min(1).max(100),
});
export type CandidateScene = z.infer<typeof CandidateSceneSchema>;
export const CandidateBatchSchema = z.object({
  candidates: z.array(CandidateContentSchema).max(2),
});
export const FinalSelectionSchema = z.object({
  selectedCandidateIds: z.array(z.string().min(1)).min(1).max(6),
});

export const StudyTranslationSchema = z.object({
  cueId: z.string().min(1),
  text: z.string().min(1).max(700),
});
export const ContextualWordNoteSchema = z.object({
  surface: z.string().min(1).max(160),
  meaning: z.string().min(1).max(400),
  explanation: z.string().min(1).max(700),
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
export const ContextualDialogueLineSchema = z.object({
  text: z.string().min(1).max(500),
  translation: z.string().min(1).max(700),
  pronunciation: z.array(PronunciationSegmentSchema).min(1).max(100).optional().catch(undefined),
});
export const ContextualExampleSchema = z.object({
  situation: z.string().min(1).max(450),
  dialogue: z.array(ContextualDialogueLineSchema).min(2).max(3),
});
export const ContextualFocusSchema = z.object({
  expression: z.string().min(1).max(160),
  sourceCueIds: z.array(z.string().min(1)).min(1).max(10),
  meaning: z.string().min(1).max(400),
  contextExplanation: z.string().min(1).max(1400),
  contextCueIds: z.array(z.string().min(1)).min(1).max(10),
  wordNotes: z.array(ContextualWordNoteSchema).max(3),
  examples: z.array(ContextualExampleSchema).min(1).max(3),
});
/** Model output has semantic content only; original IDs and timestamps come from the Host. */
export const ContextualSceneContentSchema = z.object({
  title: z.string().min(1).max(180),
  context: z.string().min(1).max(2400),
  translations: z.array(StudyTranslationSchema).min(1).max(10),
  pronunciations: z.array(CuePronunciationSchema).max(10).optional().catch(undefined),
  focusItems: z.array(ContextualFocusSchema).min(1).max(2),
});
export const ContextualSceneSchema = ContextualSceneContentSchema.extend({
  id: z.string().uuid(),
  cueIds: z.array(z.string().min(1)).min(1).max(10),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  focusItems: z.array(ContextualFocusSchema).min(1).max(2),
});
export type ContextualScene = z.infer<typeof ContextualSceneSchema>;

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
export const LearningDocumentSchema = DocumentCommonSchema.extend({
  schemaVersion: z.literal(5),
  sections: z.array(ContextualSceneSchema).min(1).max(6),
  playbackOverrides: z.record(z.string().min(1).max(80), PlaybackOverrideSchema).optional(),
  scenePlaybackOverrides: z.record(z.string().uuid(), PlaybackOverrideSchema).optional(),
});
export type LearningDocument = z.infer<typeof LearningDocumentSchema>;
