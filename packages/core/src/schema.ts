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
});
export type LearningProfile = z.infer<typeof LearningProfileSchema>;

export const AgentSettingsSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  modelId: z.string().max(120),
  accountConfigDir: z.string().max(1024).optional(),
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

const CustomAgentArgSchema = z.string().max(500).refine(value => !value.includes("\\0"), "Agent arguments cannot contain NUL bytes");
export const CustomAgentDefinitionSchema = z.object({
  id: z.string().regex(/^custom-[a-z0-9][a-z0-9-]{0,31}$/),
  label: z.string().trim().min(1).max(80),
  executable: z.string().trim().min(1).max(1024)
    .refine(value => !value.includes("\\0"), "Executable cannot contain NUL bytes"),
  args: z.array(CustomAgentArgSchema).max(24).default([]),
  modelArgument: z.string().regex(/^--?[A-Za-z0-9][A-Za-z0-9-]{0,63}$/).optional(),
  responsePath: z.string().regex(/^[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+){0,5}$/).optional(),
}).superRefine((value, ctx) => {
  const promptSlots = value.args.filter(arg => arg.includes("{prompt}")).length;
  const modelSlots = value.args.filter(arg => arg.includes("{model}")).length;
  if (promptSlots > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use at most one {prompt} placeholder" });
  if (modelSlots > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Use at most one {model} placeholder" });
});
export type CustomAgentDefinition = z.infer<typeof CustomAgentDefinitionSchema>;

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
export const LearningDocumentSchema = z.discriminatedUnion("schemaVersion", [
  LearningDocumentV1Schema, LearningDocumentV2Schema,
]);
export type LearningDocument = z.infer<typeof LearningDocumentSchema>;

export interface AgentModel { id: string; label: string }
export type AgentModelSource = "cli" | "aliases" | "unavailable";
export interface AgentProfile { id: string; provider: string; label: string; directory: string }

export const HostRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("health"), id: z.string().uuid() }),
  z.object({ type: z.literal("agentModels"), id: z.string().uuid(), settings: AgentSettingsSchema }),
  z.object({ type: z.literal("customAgents"), id: z.string().uuid() }),
  z.object({ type: z.literal("customAgentSave"), id: z.string().uuid(), definition: CustomAgentDefinitionSchema }),
  z.object({ type: z.literal("customAgentRemove"), id: z.string().uuid(), agentId: z.string().regex(/^custom-[a-z0-9][a-z0-9-]{0,31}$/) }),
  z.object({ type: z.literal("customAgentTest"), id: z.string().uuid(), definition: CustomAgentDefinitionSchema }),
  z.object({ type: z.literal("agentProfiles"), id: z.string().uuid() }),
  z.object({ type: z.literal("agentProfileSave"), id: z.string().uuid(),
    provider: z.enum(["claude", "codex"]), label: z.string().min(1).max(80),
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
  | { id: string; type: "customAgents"; agents: CustomAgentDefinition[] }
  | { id: string; type: "customAgentTest"; ok: true; executable: string }
  | { id: string; type: "agentProfiles"; profiles: AgentProfile[] }
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
