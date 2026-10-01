import { z } from "zod";
import {
  AgentSettingsSchema, CustomAgentConfigSchema, CustomAgentImportSchema,
  GenerationRequestSchema, PlaybackOverrideSchema,
  type CustomAgentConfig, type DriveAccount, type DriveLessonSummary,
  type DuplicateMatch, type LearningDocument, type LessonSummary, type PlaybackOverride,
} from "./schema";

export interface AgentModel { id: string; label: string; thinkingLevels?: import("./schema").ThinkingLevel[] }
export type AgentModelSource = "cli" | "sdk" | "unavailable";
export interface AgentProfile { id: string; provider: string; label: string; directory: string }

export const PiPromptSchema = z.object({
  promptId: z.string().uuid(), kind: z.enum(["text", "secret", "select", "manual_code"]),
  message: z.string().max(20000), options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});
export const PiEventSchema = z.object({ message: z.string().max(20000), url: z.string().url().optional() });
export const PiProviderInfoSchema = z.object({ id: z.string(), label: z.string(), connected: z.boolean(),
  methods: z.array(z.enum(["api_key", "oauth"])) });
export type PiPrompt = z.infer<typeof PiPromptSchema>;
export type PiEvent = z.infer<typeof PiEventSchema>;

export const HostRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("piProviders"), id: z.string().uuid() }),
  z.object({ type: z.literal("piLogin"), id: z.string().uuid(), provider: z.string().max(40), method: z.enum(["api_key", "oauth"]) }),
  z.object({ type: z.literal("piLogout"), id: z.string().uuid(), provider: z.string().max(40) }),
  z.object({ type: z.literal("piAuthAnswer"), id: z.string().uuid(), loginId: z.string().uuid(), promptId: z.string().uuid(), value: z.string().max(20000) }),
  z.object({ type: z.literal("piAuthCancel"), id: z.string().uuid(), loginId: z.string().uuid() }),
  z.object({ type: z.literal("health"), id: z.string().uuid() }),
  z.object({ type: z.literal("agentModels"), id: z.string().uuid(), settings: AgentSettingsSchema }),
  z.object({ type: z.literal("agentProfiles"), id: z.string().uuid() }),
  z.object({ type: z.literal("customAgentList"), id: z.string().uuid() }),
  z.object({ type: z.literal("customAgentImport"), id: z.string().uuid(), config: CustomAgentImportSchema }),
  z.object({ type: z.literal("customAgentSave"), id: z.string().uuid(), config: CustomAgentConfigSchema }),
  z.object({ type: z.literal("customAgentRemove"), id: z.string().uuid(), agentId: z.string().regex(/^custom-[a-f0-9]{24}$/) }),
  z.object({ type: z.literal("customAgentTest"), id: z.string().uuid(), config: CustomAgentConfigSchema,
    modelId: z.string().max(120), accountConfigDir: z.string().max(1024).optional() }),
  z.object({ type: z.literal("customAgentProbe"), id: z.string().uuid(),
    executable: z.string().min(1).max(1024) }),
  z.object({ type: z.literal("agentProfileSave"), id: z.string().uuid(),
    provider: z.string().regex(/^custom-[a-f0-9]{24}$/), label: z.string().min(1).max(80),
    directory: z.string().min(1).max(1024) }),
  z.object({ type: z.literal("agentProfileRemove"), id: z.string().uuid(), profileId: z.string().uuid() }),
  z.object({ type: z.literal("generate"), id: z.string().uuid(), payload: GenerationRequestSchema,
    checkToken: z.string().uuid(), confirmRegeneration: z.boolean() }),
  z.object({ type: z.literal("cancel"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("listEndedJobs"), id: z.string().uuid() }),
  z.object({ type: z.literal("deleteJobHistory"), id: z.string().uuid(), jobIds: z.array(z.string().uuid()).min(1) }),
  z.object({ type: z.literal("listJobs"), id: z.string().uuid() }),
  z.object({ type: z.literal("listLessons"), id: z.string().uuid() }),
  z.object({ type: z.literal("listDriveLessons"), id: z.string().uuid(), accountId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("restoreDriveLesson"), id: z.string().uuid(), accountId: z.string().min(1).max(256), documentId: z.string().uuid() }),
  z.object({ type: z.literal("backupExisting"), id: z.string().uuid(), accountId: z.string().min(1).max(256) }),
  z.object({ type: z.literal("resume"), id: z.string().uuid(), jobId: z.string().uuid() }),
  z.object({ type: z.literal("getDocument"), id: z.string().uuid(), documentId: z.string().uuid() }),
  z.object({ type: z.literal("savePlaybackRange"), id: z.string().uuid(), documentId: z.string().uuid(),
    cueId: z.string().min(1).max(80), range: PlaybackOverrideSchema.nullable() }),
  z.object({ type: z.literal("saveScenePlaybackRange"), id: z.string().uuid(), documentId: z.string().uuid(),
    sceneId: z.string().uuid(), range: PlaybackOverrideSchema.nullable() }),
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
  | { id: string; type: "piProviders"; providers: import("./pi-providers").PiProviderInfo[] }
  | { id: string; type: "piAuthPrompt"; prompt: PiPrompt }
  | { id: string; type: "piAuthEvent"; event: PiEvent }
  | { id: string; type: "piAuthDone" }
  | { id: string; type: "piAuthPromptClosed"; promptId: string }
  | { id: string; type: "health"; installed: Record<string, boolean>; agents: AgentInfo[];
    version?: string; agentMode?: "imported-only" | "pi-sdk"; protocolVersion?: number }
  | { id: string; type: "agentModels"; models: AgentModel[]; source: AgentModelSource; notice?: string }
  | { id: string; type: "agentProfiles"; profiles: AgentProfile[] }
  | { id: string; type: "customAgentList"; agents: CustomAgentConfig[] }
  | { id: string; type: "customAgentImported"; agent: CustomAgentConfig; agents: CustomAgentConfig[] }
  | { id: string; type: "customAgentTested"; label: string }
  | { id: string; type: "customAgentProbed"; installed: boolean; resolved?: string }
  | { id: string; type: "progress"; jobId: string; completed: number; total: number }
  | { id: string; type: "job"; job: import("./jobs").JobSummary }
  | { id: string; type: "jobHistoryDeleted"; deleted: string[]; failed: { jobId: string; message: string }[] }
  | { id: string; type: "jobs"; jobs: import("./jobs").JobSummary[] }
  | { id: string; type: "lessons"; lessons: LessonSummary[] }
  | { id: string; type: "driveLessons"; lessons: DriveLessonSummary[] }
  | { id: string; type: "driveRestored"; documentId: string }
  | { id: string; type: "backupsScheduled"; count: number }
  | { id: string; type: "documentChunk"; documentId: string; index: number; total: number; dataBase64: string }
  | { id: string; type: "result"; document: LearningDocument }
  | { id: string; type: "playbackRangeSaved"; cueId: string; range: PlaybackOverride | null; warning?: string }
  | { id: string; type: "scenePlaybackRangeSaved"; sceneId: string; range: PlaybackOverride | null; warning?: string }
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
