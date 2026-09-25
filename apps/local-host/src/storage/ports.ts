import type { JobSnapshot, JobSummary, LearningDocument, StudyProgress } from "@immersive/core";

export interface JobRepository {
  create(job: JobSnapshot): Promise<void>;
  get(id: string): Promise<JobSnapshot | null>;
  list(limit?: number): Promise<JobSummary[]>;
  update(id: string, change: (current: JobSnapshot) => JobSnapshot): Promise<JobSnapshot>;
}

export interface DocumentRepository {
  get(id: string): Promise<LearningDocument | null>;
  save(document: LearningDocument, markdown: string): Promise<void>;
}

export interface ProgressRepository {
  get(documentId: string): Promise<StudyProgress | null>;
  save(progress: StudyProgress): Promise<void>;
}

/** One repository instance is a single writer. Synchronization across processes belongs to a future daemon. */
export interface StoragePorts {
  jobs: JobRepository;
  documents: DocumentRepository;
  progress: ProgressRepository;
}
