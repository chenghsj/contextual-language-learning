import { z } from "zod";
import { SystemVoiceSchema } from "./speech";

export const SpeechDownloadIdSchema = z.string().uuid().brand<"SpeechDownloadId">();
export type SpeechDownloadId = z.infer<typeof SpeechDownloadIdSchema>;
export const SpeechDownloadOperationSchema = z.object({
  operationId: SpeechDownloadIdSchema,
  voiceId: z.string().min(1).max(256),
});
export type SpeechDownloadOperation = z.infer<typeof SpeechDownloadOperationSchema>;
export const SpeechDownloadObservationSchema = SpeechDownloadOperationSchema.extend({
  resource: z.enum(["installed", "downloaded-unusable", "absent"]),
  subscription: z.enum(["present", "absent"]),
  ordering: z.enum(["settled", "unconfirmed"]),
  cancelFenced: z.boolean(),
  shared: z.boolean(),
});
export type SpeechDownloadObservation = z.infer<typeof SpeechDownloadObservationSchema>;
export const SpeechDownloadProgressSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("requesting") }),
  z.object({ status: z.literal("waiting-system") }),
  z.object({ status: z.literal("cancelling") }),
  z.object({ status: z.literal("completed"), endedAt: z.string().datetime() }),
  z.object({ status: z.literal("cancelled"), endedAt: z.string().datetime(), shared: z.boolean() }),
  z.object({
    status: z.literal("failed"),
    endedAt: z.string().datetime(),
    reason: z.enum(["rejected", "resource-unavailable", "subscription-lost"]),
  }),
]);
export const SpeechDownloadQuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fresh"), checkedAt: z.string().datetime() }),
  z.object({ kind: z.literal("reconciling") }),
  z.object({ kind: z.literal("unavailable") }),
]);
export const SpeechDownloadTaskSchema = z.object({
  id: SpeechDownloadIdSchema,
  voice: SystemVoiceSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  progress: SpeechDownloadProgressSchema,
  observation: SpeechDownloadQuerySchema,
});
export type SpeechDownloadTask = z.infer<typeof SpeechDownloadTaskSchema>;
export const StoredSpeechDownloadSchema = z.object({
  task: SpeechDownloadTaskSchema,
  dispatch: z.enum(["intent", "may-have-been-sent"]),
  cancelRequested: z.boolean(),
  sawSubscription: z.boolean(),
  withdrawalSettled: z.boolean(),
});
export type StoredSpeechDownload = z.infer<typeof StoredSpeechDownloadSchema>;
export const SpeechDownloadStoreSchema = z
  .object({
    version: z.literal(1),
    records: z.array(StoredSpeechDownloadSchema).max(1000),
  })
  .superRefine((store, context) => {
    if (new Set(store.records.map(record => record.task.id)).size !== store.records.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate speech download history IDs.",
      });
  });
export const SpeechDownloadSnapshotSchema = z.object({
  type: z.literal("speechDownloadSnapshot"),
  ready: z.boolean(),
  revision: z.number().int().nonnegative(),
  service: z.enum(["ready", "reconciling", "unavailable", "storage-error"]),
  paused: z.boolean(),
  tasks: z.array(SpeechDownloadTaskSchema).max(1000),
});
export type SpeechDownloadSnapshot = z.infer<typeof SpeechDownloadSnapshotSchema>;
export const SpeechDownloadCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("watch"), id: z.string().uuid() }),
  z.object({
    type: z.literal("start"),
    id: z.string().uuid(),
    voiceId: z.string().min(1).max(256),
  }),
  z.object({ type: z.literal("cancel"), id: z.string().uuid(), taskId: SpeechDownloadIdSchema }),
  z.object({ type: z.literal("retry"), id: z.string().uuid(), taskId: SpeechDownloadIdSchema }),
  z.object({ type: z.literal("reconcile"), id: z.string().uuid() }),
  z.object({
    type: z.literal("clearEnded"),
    id: z.string().uuid(),
    taskIds: z.array(SpeechDownloadIdSchema).min(1).max(1000),
  }),
]);
export const SpeechDownloadViewMessageSchema = z.discriminatedUnion("type", [
  SpeechDownloadSnapshotSchema,
  z.object({
    type: z.literal("speechDownloadReply"),
    id: z.string().uuid(),
    taskId: SpeechDownloadIdSchema.optional(),
    error: z.string().max(1000).optional(),
  }),
  z.object({ type: z.literal("speechDownloadNotice"), task: SpeechDownloadTaskSchema }),
]);
export const SPEECH_DOWNLOAD_PORT = "contextual:speech-downloads";
export function isSpeechDownloadActive(task: SpeechDownloadTask): boolean {
  return ["requesting", "waiting-system", "cancelling"].includes(task.progress.status);
}
export function speechDownloadMatchesVoice(
  task: SpeechDownloadTask,
  voice: z.infer<typeof SystemVoiceSchema>,
): boolean {
  const ids = new Set([task.voice.id, ...(task.voice.aliases ?? [])]);
  return (
    [voice.id, ...(voice.aliases ?? [])].some(id => ids.has(id)) ||
    Boolean(
      voice.resourceId &&
      task.voice.resourceId === voice.resourceId &&
      voice.language.toLowerCase() === task.voice.language.toLowerCase(),
    )
  );
}
