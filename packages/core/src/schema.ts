import { z } from "zod";

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
  targetLanguage: z.enum(["en", "ja", "ko"]),
  instructionLanguage: z.enum(["zh-TW", "zh-CN", "en", "ja", "ko"]),
  level: z.string().min(1).max(12),
  mode: z.enum(["adaptive", "guided", "immersive"]),
  maxNewVocabulary: z.number().int().min(1).max(30),
  exerciseCount: z.number().int().min(0).max(12),
});
export type LearningProfile = z.infer<typeof LearningProfileSchema>;

export const AgentSettingsSchema = z.object({
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  modelId: z.string().max(120),
  accountConfigDir: z.string().max(1024).optional(),
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const GenerationRequestSchema = z.object({
  id: z.string().uuid(),
  source: SourceSchema,
  profile: LearningProfileSchema,
  agent: AgentSettingsSchema,
  cues: z.array(SubtitleCueSchema).min(1).max(3000),
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

export const LearningDocumentSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime(),
  source: SourceSchema,
  profile: LearningProfileSchema,
  generation: AgentSettingsSchema,
  cues: z.array(SubtitleCueSchema),
  sections: z.array(LearningSectionSchema).min(1),
});
export type LearningDocument = z.infer<typeof LearningDocumentSchema>;

export const HostRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("health"), id: z.string().uuid() }),
  z.object({ type: z.literal("generate"), id: z.string().uuid(), payload: GenerationRequestSchema }),
  z.object({ type: z.literal("cancel"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("listJobs"), id: z.string().uuid() }),
  z.object({ type: z.literal("resume"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("getDocument"), id: z.string().uuid(), documentId: z.string().uuid() }),
]);
export type HostRequest = z.infer<typeof HostRequestSchema>;

export interface AgentInfo {
  id: string;
  label: string;
  installed: boolean;
  supportsAccountProfiles: boolean;
}

export type HostMessage =
  | { id: string; type: "health"; installed: Record<string, boolean>; agents: AgentInfo[] }
  | { id: string; type: "progress"; jobId: string; completed: number; total: number }
  | { id: string; type: "job"; job: import("./jobs").JobSummary }
  | { id: string; type: "jobs"; jobs: import("./jobs").JobSummary[] }
  | { id: string; type: "documentChunk"; documentId: string; index: number; total: number; dataBase64: string }
  | { id: string; type: "result"; document: LearningDocument }
  | { id: string; type: "cancelled" }
  | { id: string; type: "error"; message: string };
