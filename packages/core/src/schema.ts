import { z } from "zod";
import { LEARNING_LANGUAGES, EXPLANATION_LANGUAGES } from "./languages";

export const SubtitleCueSchema = z.object({
  id: z.string().min(1).max(80),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  originalText: z.string().min(1).max(1500),
}).refine(cue => cue.startMs === null || cue.endMs === null || cue.endMs >= cue.startMs, {
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
  mode: z.enum(["adaptive", "guided", "immersive"]),
  maxNewVocabulary: z.number().int().min(1).max(30),
  exerciseCount: z.number().int().min(0).max(12),
  sceneCount: z.number().int().min(1).max(6).default(4),
  /** AI-created situations per focus expression; legacy profiles may omit this. */
  contextualExampleCount: z.number().int().min(1).max(3).optional(),
});
export type LearningProfile = z.infer<typeof LearningProfileSchema>;

/** Configured by the user, stored only by the local Native Host. Never contains credentials. */
export const CustomAgentConfigSchema = z.object({
  id: z.string().regex(/^custom-[a-f0-9]{24}$/),
  label: z.string().trim().min(1).max(80),
  executable: z.string().min(1).max(1024).refine(value => !/[\r\n\0]/.test(value))
    .transform(value => value.trim()).refine(value => value.length > 0),
  args: z.array(z.string().max(1024).refine(value => !/[\r\n\0]/.test(value))).max(32),
  promptMode: z.enum(["argument", "stdin"]),
  outputMode: z.enum(["stdout-json", "file-json"]),
  modelArgument: z.string().regex(/^--?[A-Za-z][A-Za-z0-9-]*$/).max(64).optional(),
  modelListArgs: z.array(z.string().max(128).regex(/^[^\r\n\0{}]*$/)).max(8).optional(),
  profileEnvVar: z.string().regex(/^[A-Z][A-Z0-9_]{0,55}(?:_HOME|_CONFIG_DIR)$/).optional(),
}).superRefine((config, ctx) => {
  const hasPrompt = config.args.some(arg => arg.includes("{prompt}"));
  const hasOutput = config.args.some(arg => arg.includes("{output}"));
  if (config.promptMode === "argument" && !hasPrompt)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Argument mode requires {prompt} in argv" });
  if (config.promptMode === "stdin" && hasPrompt)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stdin mode must not duplicate {prompt} in argv" });
  if (config.outputMode === "file-json" && !hasOutput)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "File mode requires {output} in argv" });
  if (config.outputMode === "stdout-json" && hasOutput)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stdout mode must not reference {output}" });
  if (config.args.some(arg => [...arg.matchAll(/\{([a-z][a-z0-9_]*)\}/gi)].some(match =>
    match[1] !== "prompt" && match[1] !== "output")))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown argv placeholder" });
});
export type CustomAgentConfig = z.infer<typeof CustomAgentConfigSchema>;

export const AgentSettingsSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  modelId: z.string().max(120),
  accountConfigDir: z.string().max(1024).optional(),
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const DestinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), directory: z.string().min(1).max(2048).optional() }),
  z.object({ kind: z.literal("drive"), accountId: z.string().min(1).max(256) }),
]);
export type Destination = z.infer<typeof DestinationSchema>;

export const BackupSettingsSchema = z.object({
  enabled: z.boolean(),
  accountId: z.string().min(1).max(256).optional(),
}).refine(value => !value.enabled || !!value.accountId, "A connected Google account is required for backup");
export type BackupSettings = z.infer<typeof BackupSettingsSchema>;

export const DriveAccountSchema = z.object({
  id: z.string().min(1).max(256),
  email: z.string().email().max(320),
});
export type DriveAccount = z.infer<typeof DriveAccountSchema>;

export interface LessonSummary {
  documentId: string; title: string; createdAt: string; targetLanguage: string; level: string;
  backup?: { status: string; accountId: string; location?: string; error?: string };
}
export interface DriveLessonSummary {
  documentId: string; title: string; createdAt: string; accountId: string; url: string;
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

export const GenerationRequestSchema = z.object({
  id: z.string().uuid(),
  source: SourceSchema,
  profile: LearningProfileSchema,
  /** Explicit opt-in keeps in-progress V2 generation checkpoints compatible. */
  lessonFormat: z.enum(["classic-v2", "contextual-v3"]).optional(),
  agent: AgentSettingsSchema,
  destination: DestinationSchema.optional(),
  backup: BackupSettingsSchema.optional(),
  cues: z.array(SubtitleCueSchema).min(1).max(3000),
  outputPath: z.string().max(2048).optional(),
  allowRegenerate: z.boolean().optional(),
}).refine(request => request.cues.reduce((sum, cue) => sum + cue.originalText.length, 0) <= 220_000, {
  message: "Transcript exceeds the 220,000-character limit; select a shorter section",
});
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

export const VocabularySchema = z.object({
  expression: z.string().min(1).max(160),
  meaning: z.string().min(1).max(400),
  explanation: z.string().min(1).max(1400),
  example: z.string().max(500),
});
export const ExerciseSchema = z.object({
  question: z.string().min(1).max(1000),
  answer: z.string().max(1000),
});
export const SectionContentSchema = z.object({
  title: z.string().min(1).max(180),
  context: z.string().min(1).max(2400),
  vocabulary: z.array(VocabularySchema).max(30),
  insights: z.array(z.string().min(1).max(1200)).max(12),
  exercises: z.array(ExerciseSchema).max(12),
});
export type SectionContent = z.infer<typeof SectionContentSchema>;

export const LearningSectionSchema = SectionContentSchema.extend({
  id: z.string().uuid(),
  cueIds: z.array(z.string()).min(1),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
});
export type LearningSection = z.infer<typeof LearningSectionSchema>;

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
export const StudyExerciseSchema = ExerciseSchema.extend({
  type: z.enum(["substitution", "situational", "comprehension"]),
});
export const StudySceneContentSchema = SectionContentSchema.extend({
  translations: z.array(StudyTranslationSchema).min(1).max(10),
  exercises: z.array(StudyExerciseSchema).max(1),
  vocabulary: z.array(VocabularySchema).max(2),
  insights: z.array(z.string().min(1).max(1200)).max(1),
});
export const StudySceneSchema = StudySceneContentSchema.extend({
  id: z.string().uuid(),
  learningGoal: z.string().min(1).max(250),
  cueIds: z.array(z.string().min(1)).min(1).max(10),
  focusCueIds: z.array(z.string().min(1)).min(1).max(2),
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
});
export type StudyScene = z.infer<typeof StudySceneSchema>;

/** V3 preserves V2's cue/timing and vocabulary fields for safe older-reader fallback. */
export const ContextualWordNoteSchema = z.object({
  surface: z.string().min(1).max(160),
  meaning: z.string().min(1).max(400),
  explanation: z.string().min(1).max(700),
});
export const ContextualDialogueLineSchema = z.object({
  text: z.string().min(1).max(500),
  translation: z.string().min(1).max(700),
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
  focusItems: z.array(ContextualFocusSchema).min(1).max(2),
});
export const StudySceneV3Schema = StudySceneSchema.extend({
  focusItems: z.array(ContextualFocusSchema).min(1).max(2),
});
export type StudySceneV3 = z.infer<typeof StudySceneV3Schema>;

const DocumentCommonSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  source: SourceSchema,
  profile: LearningProfileSchema,
  generation: AgentSettingsSchema,
  cues: z.array(SubtitleCueSchema),
});
export const LearningDocumentV1Schema = DocumentCommonSchema.extend({
  schemaVersion: z.literal(1),
  sections: z.array(LearningSectionSchema).min(1),
});
export const LearningDocumentV2Schema = DocumentCommonSchema.extend({
  schemaVersion: z.literal(2),
  sections: z.array(StudySceneSchema).min(1).max(6),
});
/** Calibrated playback windows never replace the canonical subtitle timestamps. */
export const PlaybackOverrideSchema = z.object({
  startMs: z.number().int().min(0).max(43_200_000),
  endMs: z.number().int().min(0).max(43_200_000),
}).refine(range => range.endMs - range.startMs >= 250 && range.endMs - range.startMs <= 600_000,
  { message: "Playback duration must be between 0.25s and 10min" });
export type PlaybackOverride = z.infer<typeof PlaybackOverrideSchema>;
export const LearningDocumentV3Schema = DocumentCommonSchema.extend({
  schemaVersion: z.literal(3),
  sections: z.array(StudySceneV3Schema).min(1).max(6),
  /** Presence (including an empty map) takes precedence over legacy browser-only calibration. */
  playbackOverrides: z.record(z.string().min(1).max(80), PlaybackOverrideSchema).optional(),
});
export const LearningDocumentSchema = z.discriminatedUnion("schemaVersion", [
  LearningDocumentV1Schema, LearningDocumentV2Schema, LearningDocumentV3Schema,
]);
export type LearningDocument = z.infer<typeof LearningDocumentSchema>;

export interface AgentModel { id: string; label: string }
export type AgentModelSource = "cli" | "aliases" | "unavailable";
export interface AgentProfile { id: string; provider: string; label: string; directory: string }

export const HostRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("health"), id: z.string().uuid() }),
  z.object({ type: z.literal("agentModels"), id: z.string().uuid(), settings: AgentSettingsSchema }),
  z.object({ type: z.literal("agentProfiles"), id: z.string().uuid() }),
  z.object({ type: z.literal("customAgentList"), id: z.string().uuid() }),
  z.object({ type: z.literal("customAgentSave"), id: z.string().uuid(), config: CustomAgentConfigSchema }),
  z.object({ type: z.literal("customAgentRemove"), id: z.string().uuid(), agentId: z.string().regex(/^custom-[a-f0-9]{24}$/) }),
  z.object({ type: z.literal("customAgentTest"), id: z.string().uuid(), config: CustomAgentConfigSchema,
    modelId: z.string().max(120), accountConfigDir: z.string().max(1024).optional() }),
  z.object({ type: z.literal("customAgentProbe"), id: z.string().uuid(),
    executable: z.string().min(1).max(1024) }),
  z.object({ type: z.literal("agentProfileSave"), id: z.string().uuid(),
    provider: z.string().regex(/^(?:claude|codex|custom-[a-f0-9]{24})$/), label: z.string().min(1).max(80),
    directory: z.string().min(1).max(1024) }),
  z.object({ type: z.literal("agentProfileRemove"), id: z.string().uuid(), profileId: z.string().uuid() }),
  z.object({ type: z.literal("generate"), id: z.string().uuid(), payload: GenerationRequestSchema,
    checkToken: z.string().uuid(), confirmRegeneration: z.boolean() }),
  z.object({ type: z.literal("cancel"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("listJobs"), id: z.string().uuid() }),
  z.object({ type: z.literal("listLessons"), id: z.string().uuid() }),
  z.object({ type: z.literal("listDriveLessons"), id: z.string().uuid(), accountId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("restoreDriveLesson"), id: z.string().uuid(), accountId: z.string().min(1).max(256), documentId: z.string().uuid() }),
  z.object({ type: z.literal("backupExisting"), id: z.string().uuid(), accountId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("resume"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("getDocument"), id: z.string().uuid(), documentId: z.string().uuid() }),
  z.object({ type: z.literal("savePlaybackRange"), id: z.string().uuid(), documentId: z.string().uuid(),
    cueId: z.string().min(1).max(80), range: PlaybackOverrideSchema.nullable() }),
  z.object({ type: z.literal("storageLocations"), id: z.string().uuid() }),
  z.object({ type: z.literal("preflight"), id: z.string().uuid(), payload: GenerationRequestSchema }),
  z.object({ type: z.literal("checkDuplicates"), id: z.string().uuid(), payload: GenerationRequestSchema }),
  z.object({ type: z.literal("chooseFolder"), id: z.string().uuid() }),
  z.object({ type: z.literal("driveAccounts"), id: z.string().uuid() }),
  z.object({ type: z.literal("driveDisconnect"), id: z.string().uuid(), accountId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("driveConnect"), id: z.string().uuid() }),
  z.object({ type: z.literal("driveValidate"), id: z.string().uuid(), accountId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("publishJob"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("retryBackup"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("resumeBackups"), id: z.string().uuid() }),
]);
export type HostRequest = z.infer<typeof HostRequestSchema>;

export interface AgentInfo {
  id: string;
  label: string;
  installed: boolean;
  supportsAccountProfiles: boolean;
  custom?: boolean;
}

export type HostMessage =
  | { id: string; type: "health"; installed: Record<string, boolean>; agents: AgentInfo[]; version?: string }
  | { id: string; type: "agentModels"; models: AgentModel[]; source: AgentModelSource; notice?: string }
  | { id: string; type: "agentProfiles"; profiles: AgentProfile[] }
  | { id: string; type: "customAgentList"; agents: CustomAgentConfig[] }
  | { id: string; type: "customAgentTested"; label: string }
  | { id: string; type: "customAgentProbed"; installed: boolean; resolved?: string }
  | { id: string; type: "progress"; jobId: string; completed: number; total: number }
  | { id: string; type: "job"; job: import("./jobs").JobSummary }
  | { id: string; type: "jobs"; jobs: import("./jobs").JobSummary[] }
  | { id: string; type: "lessons"; lessons: LessonSummary[] }
  | { id: string; type: "driveLessons"; lessons: DriveLessonSummary[] }
  | { id: string; type: "driveRestored"; documentId: string }
  | { id: string; type: "backupsScheduled"; count: number }
  | { id: string; type: "documentChunk"; documentId: string; index: number; total: number; dataBase64: string }
  | { id: string; type: "storageLocations"; locations: { id: string; kind: "local" | "google-drive-desktop"; label: string; path: string; account?: string }[] }
  | { id: string; type: "preflight"; existing: { id: string; title: string; createdAt: string; path: string }[] }
  | { id: string; type: "result"; document: LearningDocument }
  | { id: string; type: "playbackRangeSaved"; cueId: string; range: PlaybackOverride | null; warning?: string }
  | { id: string; type: "duplicates"; token: string; matches: DuplicateMatch[] }
  | { id: string; type: "folder"; directory: string }
  | { id: string; type: "driveAccounts"; accounts: DriveAccount[]; configured: boolean }
  | { id: string; type: "driveConnected"; account: DriveAccount }
  | { id: string; type: "driveValidated"; accountId: string }
  | { id: string; type: "driveDisconnected"; accountId: string }
  | { id: string; type: "published"; jobId: string; location: string }
  | { id: string; type: "publicationFailed"; jobId: string; message: string }
  | { id: string; type: "backupPublished"; jobId: string; location: string }
  | { id: string; type: "backupFailed"; jobId: string; message: string }
  | { id: string; type: "backupsFinished" }
  | { id: string; type: "generationSettled" }
  | { id: string; type: "cancelled" }
  | { id: string; type: "error"; message: string };
