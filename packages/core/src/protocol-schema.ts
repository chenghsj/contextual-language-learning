import { CustomGenerationRequestSchema } from "./custom";
import { z } from "zod";
import { SpeechInputSchema } from "./speech";
import { AgentSettingsSchema, GenerationRequestSchema, PlaybackOverrideSchema } from "./schema";

export interface AgentModel {
  id: string;
  label: string;
  thinkingLevels?: import("./schema").ThinkingLevel[];
  disabled?: boolean;
  availability?: "listed" | "unknown";
}
export type AgentModelSource = "sdk" | "unavailable";

export const PiPromptSchema = z.object({
  promptId: z.string().uuid(),
  kind: z.enum(["text", "secret", "select", "manual_code"]),
  message: z.string().max(20000),
  options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});
export const PiEventSchema = z.object({
  message: z.string().max(20000),
  url: z.string().url().optional(),
});
export const PiProviderInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  connected: z.boolean(),
  methods: z.array(z.enum(["api_key", "oauth"])),
  methodLabels: z
    .object({ api_key: z.string().optional(), oauth: z.string().optional() })
    .optional(),
});
export type PiPrompt = z.infer<typeof PiPromptSchema>;
export type PiEvent = z.infer<typeof PiEventSchema>;

export const HostRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("listSpeechVoices"), id: z.string().uuid() }),
  z.object({ type: z.literal("listSpeechVoiceCatalog"), id: z.string().uuid() }),
  z.object({
    type: z.literal("getSpeechVoiceFolder"),
    id: z.string().uuid(),
    voiceId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("openSpeechVoiceFolder"),
    id: z.string().uuid(),
    voiceId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("removeSpeechVoice"),
    id: z.string().uuid(),
    voiceId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("installSpeechVoice"),
    id: z.string().uuid(),
    voiceId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("getSpeechVoiceInstallation"),
    id: z.string().uuid(),
    voiceId: z.string().min(1).max(256),
  }),
  z.object({ type: z.literal("speak"), id: z.string().uuid(), input: SpeechInputSchema }),
  z.object({ type: z.literal("stopSpeech"), id: z.string().uuid(), speechId: z.string().uuid() }),
  z.object({
    type: z.literal("estimateGeneration"),
    id: z.string().uuid(),
    payload: z.union([GenerationRequestSchema, CustomGenerationRequestSchema]),
  }),
  z.object({ type: z.literal("getJobExecution"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({
    type: z.literal("checkCustomDuplicates"),
    id: z.string().uuid(),
    payload: CustomGenerationRequestSchema,
  }),
  z.object({
    type: z.literal("generateCustom"),
    id: z.string().uuid(),
    payload: CustomGenerationRequestSchema,
    checkToken: z.string().uuid(),
    confirmRegeneration: z.boolean(),
  }),
  z.object({ type: z.literal("resumeCustom"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("cancelCustom"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({
    type: z.literal("listCustomDriveDocuments"),
    id: z.string().uuid(),
    accountId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("restoreCustomDriveDocument"),
    id: z.string().uuid(),
    accountId: z.string().min(1).max(256),
    documentId: z.string().uuid(),
  }),
  z.object({ type: z.literal("listCustomDocuments"), id: z.string().uuid() }),
  z.object({
    type: z.literal("getCustomDocument"),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
  }),
  z.object({ type: z.literal("getCustomJob"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({
    type: z.literal("renameCustomDocument"),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal("deleteCustomDocument"),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
  }),
  z.object({ type: z.literal("piProviders"), id: z.string().uuid() }),
  z.object({
    type: z.literal("piLogin"),
    id: z.string().uuid(),
    provider: z.string().max(40),
    method: z.enum(["api_key", "oauth"]),
  }),
  z.object({ type: z.literal("piLogout"), id: z.string().uuid(), provider: z.string().max(40) }),
  z.object({
    type: z.literal("piAuthAnswer"),
    id: z.string().uuid(),
    loginId: z.string().uuid(),
    promptId: z.string().uuid(),
    value: z.string().max(20000),
  }),
  z.object({ type: z.literal("piAuthCancel"), id: z.string().uuid(), loginId: z.string().uuid() }),
  z.object({
    type: z.literal("health"),
    id: z.string().uuid(),
    // Connection handshakes only need protocol/version metadata.
    includeAgents: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("agentModels"),
    id: z.string().uuid(),
    settings: AgentSettingsSchema,
  }),
  z.object({
    type: z.literal("generate"),
    id: z.string().uuid(),
    payload: GenerationRequestSchema,
    checkToken: z.string().uuid(),
    confirmRegeneration: z.boolean(),
  }),
  z.object({ type: z.literal("cancel"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("listEndedJobs"), id: z.string().uuid() }),
  z.object({
    type: z.literal("deleteJobHistory"),
    id: z.string().uuid(),
    jobIds: z.array(z.string().uuid()).min(1),
  }),
  z.object({ type: z.literal("listJobs"), id: z.string().uuid() }),
  z.object({ type: z.literal("listLessons"), id: z.string().uuid() }),
  z.object({
    type: z.literal("deleteLocalLesson"),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("listDriveLessons"),
    id: z.string().uuid(),
    accountId: z.string().min(1).max(256),
  }),
  z.object({
    type: z.literal("restoreDriveLesson"),
    id: z.string().uuid(),
    accountId: z.string().min(1).max(256),
    documentId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("backupExisting"),
    id: z.string().uuid(),
    accountId: z.string().min(1).max(256),
  }),
  z.object({ type: z.literal("resume"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({
    type: z.literal("getDocument"),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("savePlaybackRange"),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    cueId: z.string().min(1).max(80),
    range: PlaybackOverrideSchema.nullable(),
  }),
  z.object({
    type: z.literal("saveScenePlaybackRange"),
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    sceneId: z.string().uuid(),
    range: PlaybackOverrideSchema.nullable(),
  }),
  z.object({
    type: z.literal("checkDuplicates"),
    id: z.string().uuid(),
    payload: GenerationRequestSchema,
  }),
  z.object({ type: z.literal("chooseFolder"), id: z.string().uuid() }),
  z.object({
    type: z.literal("openFolder"),
    id: z.string().uuid(),
    directory: z.string().min(1).max(2048).optional(),
  }),
  z.object({ type: z.literal("driveAccounts"), id: z.string().uuid() }),
  z.object({
    type: z.literal("driveDisconnect"),
    id: z.string().uuid(),
    accountId: z.string().min(1).max(256),
  }),
  z.object({ type: z.literal("driveConnect"), id: z.string().uuid() }),
  z.object({ id: z.string().uuid(), type: z.literal("driveFolder"), accountId: z.string().min(1) }),
  z.object({
    type: z.literal("driveValidate"),
    id: z.string().uuid(),
    accountId: z.string().min(1).max(256),
  }),
  z.object({ type: z.literal("publishJob"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("retryBackup"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("resumeBackups"), id: z.string().uuid() }),
]);
export type HostRequest = z.infer<typeof HostRequestSchema>;

export interface AgentInfo {
  id: string;
  label: string;
  installed: boolean;
}

export type { HostMessage } from "./native-messaging";
