import { z } from "zod";
import {
  DestinationSchema,
  BackupSettingsSchema,
  JobSummarySchema,
  type Destination,
  type JobSnapshot,
  type JobSummary,
  type LearningDocument,
  type PlaybackOverride,
} from "@contextual/core";

export const LessonJobRecordSchema = z.object({
  schemaVersion: z.literal(1),
  summary: JobSummarySchema,
  request: z.object({
    destination: DestinationSchema.optional(),
    backup: BackupSettingsSchema.optional(),
  }),
});
export type LessonJobRecord = z.infer<typeof LessonJobRecordSchema>;

export interface JobRepository {
  deleteHistory(id: string): Promise<void>;
  getRecord(id: string): Promise<LessonJobRecord | null>;
  listRecords(): Promise<JobSummary[]>;
  updateRecord(
    id: string,
    change: (current: LessonJobRecord) => LessonJobRecord,
  ): Promise<LessonJobRecord>;
  create(job: JobSnapshot): Promise<void>;
  get(id: string): Promise<JobSnapshot | null>;
  list(limit?: number): Promise<JobSummary[]>;
  update(id: string, change: (current: JobSnapshot) => JobSnapshot): Promise<JobSnapshot>;
}

export interface DocumentRepository {
  delete(id: string): Promise<void>;
  get(id: string): Promise<LearningDocument | null>;
  list(limit?: number): Promise<LearningDocument[]>;
  save(document: LearningDocument, markdown: string): Promise<void>;
  updatePlaybackRange(
    id: string,
    cueId: string,
    range: PlaybackOverride | null,
  ): Promise<LearningDocument>;
  updateScenePlaybackRange(
    id: string,
    sceneId: string,
    range: PlaybackOverride | null,
  ): Promise<LearningDocument>;
}

/** One repository instance is a single writer. Synchronization across processes belongs to a future daemon. */
export interface StoragePorts {
  jobs: JobRepository;
  documents: DocumentRepository;
}

export type PublicationJournal = { allowed: { json: string; markdown: string }[] };
export interface DocumentPublisher {
  publish(
    document: LearningDocument,
    markdown: string,
    destination: Destination,
    journal?: PublicationJournal,
  ): Promise<string>;
}
