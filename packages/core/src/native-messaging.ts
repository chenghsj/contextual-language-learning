import { ExecutionMetadataSchema } from "./execution";
import { CustomContentSummarySchema, CustomDriveSummarySchema } from "./custom";
import { z } from "zod";
import {
  DriveAccountSchema,
  DuplicateMatchSchema,
  LearningDocumentSchema,
  PlaybackOverrideSchema,
  ThinkingLevelSchema,
} from "./schema";
import { PiPromptSchema, PiEventSchema, PiProviderInfoSchema } from "./protocol-schema";
import { JobSummarySchema } from "./jobs";

/** Increment when the Native Messaging request or response contract changes incompatibly. */
export const HOST_PROTOCOL_VERSION = 6;
const id = z.string().min(1).max(100);
const uuid = z.string().uuid();
const text = z.string().max(20_000);
const account = z.string().min(1).max(256);
const agentInfo = z.object({
  id: z.string(),
  label: z.string(),
  installed: z.boolean(),
});
const lesson = z.object({
  documentId: uuid,
  title: z.string(),
  createdAt: z.string().datetime(),
  sourceKey: z.string(),
  targetLanguage: z.string(),
  level: z.string(),
  sceneCount: z.number().int().nonnegative().optional(),
  expressionCount: z.number().int().nonnegative().optional(),
  sceneIds: z.array(uuid).optional(),
  backup: z
    .object({
      status: z.string(),
      accountId: account,
      location: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
});
const driveLesson = z.object({
  documentId: uuid,
  title: z.string(),
  createdAt: z.string().datetime(),
  sourceKey: z.string().optional(),
  accountId: account,
  url: z.string(),
  targetLanguage: z.string().optional(),
  level: z.string().optional(),
  sceneCount: z.number().int().nonnegative().optional(),
  expressionCount: z.number().int().nonnegative().optional(),
});
const base = z.object({ id });

/** Validate untrusted messages at the Extension boundary before reading their fields. */
export const HostMessageSchema = z.discriminatedUnion("type", [
  base.extend({ type: z.literal("jobExecution"), execution: ExecutionMetadataSchema.nullable() }),
  base.extend({
    type: z.literal("customDriveDocuments"),
    documents: z.array(CustomDriveSummarySchema).max(500),
  }),
  base.extend({
    type: z.literal("customDocuments"),
    documents: z.array(CustomContentSummarySchema).max(500),
  }),
  base.extend({ type: z.literal("customDocumentChanged"), documentId: uuid }),
  base.extend({
    type: z.literal("customChunk"),
    resource: z.enum(["document", "job"]),
    resourceId: uuid,
    index: z.number().int().nonnegative(),
    total: z.number().int().min(1).max(100),
    dataBase64: z.string().max(400000),
  }),
  base.extend({ type: z.literal("piProviders"), providers: z.array(PiProviderInfoSchema) }),
  base.extend({ type: z.literal("piAuthPrompt"), prompt: PiPromptSchema }),
  base.extend({ type: z.literal("piAuthEvent"), event: PiEventSchema }),
  base.extend({ type: z.literal("piAuthDone") }),
  base.extend({ type: z.literal("piAuthPromptClosed"), promptId: uuid }),
  base.extend({
    type: z.literal("health"),
    installed: z.record(z.boolean()),
    agents: z.array(agentInfo),
    version: z.string().optional(),
    agentMode: z.enum(["imported-only", "pi-sdk"]).optional(),
    protocolVersion: z.number().int().optional(),
  }),
  base.extend({
    type: z.literal("agentModels"),
    models: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        thinkingLevels: z.array(ThinkingLevelSchema).optional(),
      }),
    ),
    source: z.enum(["sdk", "unavailable"]),
    notice: z.string().optional(),
  }),
  base.extend({
    type: z.literal("progress"),
    jobId: uuid,
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }),
  base.extend({ type: z.literal("job"), job: JobSummarySchema }),
  base.extend({
    type: z.literal("jobHistoryDeleted"),
    deleted: z.array(uuid),
    failed: z.array(z.object({ jobId: uuid, message: text })),
  }),
  base.extend({ type: z.literal("jobs"), jobs: z.array(JobSummarySchema) }),
  base.extend({ type: z.literal("lessons"), lessons: z.array(lesson) }),
  base.extend({ type: z.literal("driveLessons"), lessons: z.array(driveLesson) }),
  base.extend({ type: z.literal("driveRestored"), documentId: uuid }),
  base.extend({ type: z.literal("backupsScheduled"), count: z.number().int().nonnegative() }),
  base.extend({
    type: z.literal("documentChunk"),
    documentId: uuid,
    index: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    dataBase64: z.string().max(500_000),
  }),
  base.extend({ type: z.literal("result"), document: LearningDocumentSchema }),
  base.extend({
    type: z.literal("playbackRangeSaved"),
    cueId: z.string(),
    range: PlaybackOverrideSchema.nullable(),
    warning: z.string().optional(),
  }),
  base.extend({
    type: z.literal("scenePlaybackRangeSaved"),
    sceneId: uuid,
    range: PlaybackOverrideSchema.nullable(),
    warning: z.string().optional(),
  }),
  base.extend({
    type: z.literal("duplicates"),
    token: uuid,
    matches: z.array(DuplicateMatchSchema),
  }),
  base.extend({
    type: z.literal("driveFolder"),
    accountId: z.string(),
    url: z.string().url().nullable(),
  }),
  base.extend({ type: z.literal("folder"), directory: z.string() }),
  base.extend({
    type: z.literal("driveAccounts"),
    accounts: z.array(DriveAccountSchema),
    configured: z.boolean(),
  }),
  base.extend({ type: z.literal("driveConnected"), account: DriveAccountSchema }),
  base.extend({ type: z.literal("driveValidated"), accountId: account }),
  base.extend({ type: z.literal("driveDisconnected"), accountId: account }),
  base.extend({ type: z.literal("published"), jobId: uuid, location: z.string() }),
  base.extend({ type: z.literal("publicationFailed"), jobId: uuid, message: text }),
  base.extend({ type: z.literal("backupPublished"), jobId: uuid, location: z.string() }),
  base.extend({ type: z.literal("backupFailed"), jobId: uuid, message: text }),
  base.extend({ type: z.literal("backupsFinished") }),
  base.extend({ type: z.literal("generationSettled") }),
  base.extend({ type: z.literal("cancelled") }),
  base.extend({ type: z.literal("error"), message: text }),
]);

export type HostMessage = z.infer<typeof HostMessageSchema>;

export function parseHostMessage(value: unknown): HostMessage {
  return HostMessageSchema.parse(value);
}

export function isCompatibleHostHealth(message: HostMessage): boolean {
  return (
    message.type === "health" &&
    message.protocolVersion === HOST_PROTOCOL_VERSION &&
    message.agentMode === "pi-sdk"
  );
}

/** Worker-to-panel state is a separate transport message, never a Native Host business reply. */
export const BackgroundGenerationStateSchema = z.object({
  type: z.literal("generationState"),
  connection: z
    .object({
      status: z.enum(["reconnecting", "ready", "failed", "incompatible"]),
      attempt: z.number().int().min(0).max(3),
    })
    .optional(),
  queue: z
    .array(
      z.object({
        requestId: uuid,
        jobId: uuid,
        kind: z.enum(["standard", "custom"]).optional(),
        summary: JobSummarySchema.optional(),
      }),
    )
    .optional(),
  active: z
    .object({
      requestId: uuid,
      jobId: uuid,
      kind: z.enum(["standard", "custom"]).optional(),
      summary: JobSummarySchema.optional(),
    })
    .nullable(),
});
export type BackgroundGenerationState = z.infer<typeof BackgroundGenerationStateSchema>;
