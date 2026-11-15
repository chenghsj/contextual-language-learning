import { z } from "zod";

/** Learning languages are independent of the extension's interface languages. */
export const LEARNING_LANGUAGES = [
  "en",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "id",
  "th",
  "ms",
  "vi",
  "zh-TW",
  "zh-CN",
] as const;

const EXPLANATION_LANGUAGES = LEARNING_LANGUAGES;

export const EXPLANATION_TYPES = [
  "vocabulary",
  "grammar",
  "chunks",
  "usage",
  "pronunciation",
  "culture",
] as const;
export const ExplanationTypeSchema = z.enum(EXPLANATION_TYPES);
export type ExplanationType = z.infer<typeof ExplanationTypeSchema>;

export const SourceSpanSchema = z.object({
  cueId: z.string().min(1).max(80),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
export const SentenceChunkSchema = z.object({
  id: z.string().min(1).max(80),
  spans: z.array(SourceSpanSchema).min(1).max(10),
  meaning: z.string().min(1).max(400),
  role: z.string().max(700).optional(),
  reusablePattern: z.string().max(200).optional(),
});
export type SentenceChunk = z.infer<typeof SentenceChunkSchema>;

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

export const SceneFavoriteSnapshotSchema = z
  .object({
    snapshotVersion: z.literal(1),
    origin: z
      .object({
        documentId: z.string().uuid(),
        sceneId: z.string().uuid(),
        documentRevision: z.string().min(1).max(256),
        capturedAt: z.string().datetime(),
      })
      .strict(),
    source: SourceSchema,
    profile: LearningProfileSchema,
    scene: LearningSceneV7Schema,
    cues: z.array(SubtitleCueSchema).max(3000),
    points: z.array(LearningPointSchema).max(20000),
    reusableItems: z.array(ReusableItemSchema).max(20000),
    supportingUtterances: z.array(LearningUtteranceSchema).max(20000),
    pronunciationDiagnostics: z.array(PronunciationDiagnosticSchema).max(20000),
    playbackOverrides: z.record(z.string(), PlaybackOverrideSchema),
    scenePlaybackOverrides: z.record(z.string().uuid(), PlaybackOverrideSchema),
  })
  .strict();
export type SceneFavoriteSnapshot = z.infer<typeof SceneFavoriteSnapshotSchema>;

// Custom content is a complete Markdown document, independent of generation request versions.
export const CustomFavoriteSnapshotSchema = z
  .object({
    snapshotVersion: z.literal(2),
    kind: z.literal("custom"),
    origin: SceneFavoriteSnapshotSchema.shape.origin,
    source: SourceSchema,
    document: z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(200),
        createdAt: z.string().datetime(),
        markdown: z.string().min(1).max(200000),
      })
      .strict(),
    cues: z.array(SubtitleCueSchema).max(3000),
  })
  .strict();
export type CustomFavoriteSnapshot = z.infer<typeof CustomFavoriteSnapshotSchema>;
export const FavoriteSnapshotSchema = z.discriminatedUnion("snapshotVersion", [
  SceneFavoriteSnapshotSchema,
  CustomFavoriteSnapshotSchema,
]);
export type FavoriteSnapshot = z.infer<typeof FavoriteSnapshotSchema>;
