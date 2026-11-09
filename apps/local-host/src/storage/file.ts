import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { defaultDocumentsFolder } from "../platform/paths";
import { basename, dirname, join } from "node:path";
import {
  JobSnapshotSchema,
  currentLearningExecution,
  readableLearningExecution,
  RETIRED_LESSON_MESSAGE,
  readLearningDocument,
  learningDocumentToMarkdown,
  withSentenceTiming,
  type JobSnapshot,
  type JobSummary,
  type LearningDocument,
  type PlaybackOverride,
} from "@contextual/core";
import {
  LessonJobRecordSchema,
  type LessonJobRecord,
  type DocumentRepository,
  type JobRepository,
  type StoragePorts,
} from "./ports";
import { findVideoDocument, listVideoDocuments, videoFolder } from "./video-folders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeId(id: string): string {
  if (!UUID.test(id)) throw new Error("Invalid repository ID");
  return id;
}

/** Metadata-only retired-ID detection; never parses, copies or migrates old content. */
async function hasRetiredId(root: string, id: string, kind: "job" | "document"): Promise<boolean> {
  if (basename(root) !== "data-v7") return false;
  for (const version of ["data-v6", "data-v5"]) {
    const retired = join(dirname(root), version);
    const paths =
      kind === "job"
        ? [join(retired, "jobs", id + ".json"), join(retired, "lesson-records", id + ".json")]
        : [join(retired, id + ".json"), await findVideoDocument(retired, id)];
    for (const path of paths) {
      if (!path) continue;
      try {
        await access(path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return false;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, content, { mode: 0o600, flag: "wx" });
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

export class FileJobRepository implements JobRepository {
  private readonly folder: string;
  private readonly locks = new Map<string, Promise<void>>();
  private readonly recordsFolder: string;
  constructor(private readonly root: string) {
    this.folder = join(root, "jobs");
    this.recordsFolder = join(root, "lesson-records");
  }

  private filename(id: string): string {
    return join(this.folder, safeId(id) + ".json");
  }

  async get(id: string, skipRetired = false): Promise<JobSnapshot | null> {
    try {
      const raw = JSON.parse(await readFile(this.filename(id), "utf8"));
      if (raw.schemaVersion !== 5 || !readableLearningExecution(raw.execution)) {
        if (skipRetired) return null;
        throw new Error(RETIRED_LESSON_MESSAGE);
      }
      return JobSnapshotSchema.parse(raw);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        if (!skipRetired && (await hasRetiredId(this.root, safeId(id), "job")))
          throw new Error(RETIRED_LESSON_MESSAGE);
        return null;
      }
      throw new Error("Cannot load saved job " + id + ": " + String(error));
    }
  }

  async create(job: JobSnapshot): Promise<void> {
    const valid = JobSnapshotSchema.parse(job);
    if (!currentLearningExecution(valid.execution)) throw new Error(RETIRED_LESSON_MESSAGE);
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const filename = this.filename(valid.summary.id);
    if (await this.getRecord(valid.summary.id)) throw new Error("This job ID already exists");
    await atomicWrite(filename, JSON.stringify(valid, null, 2) + "\n");
  }

  async list(limit = 50): Promise<JobSummary[]> {
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.folder)).filter(
      name => UUID.test(name.replace(/\.json$/, "")) && name.endsWith(".json"),
    );
    const items = await Promise.all(
      names.map(async name => {
        const id = name.slice(0, -5);
        const job = await this.get(id, true);
        return job?.summary ?? null;
      }),
    );
    return items
      .filter((item): item is JobSummary => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async update(id: string, change: (current: JobSnapshot) => JobSnapshot): Promise<JobSnapshot> {
    return this.withLock(id, async () => {
      const current = await this.get(id);
      if (!current) throw new Error("Job does not exist: " + id);
      const updated = JobSnapshotSchema.parse(change(current));
      if (updated.summary.id !== id) throw new Error("Job identity cannot change");
      await atomicWrite(this.filename(id), JSON.stringify(updated, null, 2) + "\n");
      return updated;
    });
  }

  private async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const lock = prior.then(() => pending);
    this.locks.set(id, lock);
    await prior;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(id) === lock) this.locks.delete(id);
    }
  }

  async getRecord(id: string, skipRetired = false): Promise<LessonJobRecord | null> {
    const job = await this.get(id, skipRetired);
    if (job) return LessonJobRecordSchema.parse({ ...job, schemaVersion: 1 });
    try {
      const raw = JSON.parse(
        await readFile(join(this.recordsFolder, safeId(id) + ".json"), "utf8"),
      );
      if (!readableLearningExecution(raw.summary?.execution)) {
        if (skipRetired) return null;
        throw new Error(RETIRED_LESSON_MESSAGE);
      }
      const record = LessonJobRecordSchema.parse(raw);
      if (record.summary.id !== id) throw new Error("Lesson record identity mismatch");
      return record;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    }
  }

  async listRecords(): Promise<JobSummary[]> {
    const jobs = await this.list(Number.MAX_SAFE_INTEGER);
    let names: string[];
    try {
      names = await readdir(this.recordsFolder);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return jobs;
      throw error;
    }
    const known = new Set(jobs.map(job => job.id));
    for (const name of names) {
      if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5)) || known.has(name.slice(0, -5)))
        continue;
      const record = await this.getRecord(name.slice(0, -5), true);
      if (record) jobs.push(record.summary);
    }
    return jobs;
  }

  async updateRecord(
    id: string,
    change: (current: LessonJobRecord) => LessonJobRecord,
  ): Promise<LessonJobRecord> {
    return this.withLock(id, async () => {
      const job = await this.get(id);
      const current = job
        ? LessonJobRecordSchema.parse({ ...job, schemaVersion: 1 })
        : await this.getRecord(id);
      if (!current) throw new Error("Lesson record not found");
      const next = LessonJobRecordSchema.parse(change(current));
      if (next.summary.id !== id) throw new Error("Lesson record identity cannot change");
      if (job) {
        const updated = JobSnapshotSchema.parse({
          ...job,
          summary: next.summary,
          request: { ...job.request, ...next.request },
        });
        await atomicWrite(this.filename(id), JSON.stringify(updated, null, 2) + "\n");
      } else {
        await atomicWrite(
          join(this.recordsFolder, safeId(id) + ".json"),
          JSON.stringify(next, null, 2) + "\n",
        );
      }
      return next;
    });
  }

  async deleteHistory(id: string): Promise<void> {
    await this.withLock(id, async () => {
      const job = await this.get(id);
      if (!job) return;
      if (!["completed", "failed", "cancelled"].includes(job.summary.status)) {
        throw new Error("Only ended jobs can be deleted");
      }
      if (job.summary.documentId) {
        await mkdir(this.recordsFolder, { recursive: true, mode: 0o700 });
        const record = LessonJobRecordSchema.parse({ ...job, schemaVersion: 1 });
        await atomicWrite(
          join(this.recordsFolder, safeId(id) + ".json"),
          JSON.stringify(record, null, 2) + "\n",
        );
      }
      await rm(this.filename(id), { force: true });
    });
  }
}

export class FileDocumentRepository implements DocumentRepository {
  private readonly locks = new Map<string, Promise<void>>();
  constructor(private readonly root: string) {}

  private documentPath(id: string): Promise<string | null> {
    return findVideoDocument(this.root, id);
  }
  /** Remove only this lesson's canonical pair, keeping other versions and exports. */
  async delete(id: string): Promise<void> {
    const path = await this.documentPath(safeId(id));
    if (!path) return;
    await rm(path.slice(0, -5) + ".md", { force: true });
    await rm(path, { force: true });
  }
  async get(id: string, skipRetired = false): Promise<LearningDocument | null> {
    const safe = safeId(id);
    const path = await this.documentPath(safe);
    if (!path) {
      if (!skipRetired && (await hasRetiredId(this.root, safe, "document")))
        throw new Error(RETIRED_LESSON_MESSAGE);
      return null;
    }
    return this.readDocument(safe, path, skipRetired);
  }
  private async readDocument(
    id: string,
    path: string,
    skipRetired: boolean,
  ): Promise<LearningDocument | null> {
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      if (raw.schemaVersion !== 7 || !readableLearningExecution(raw.execution)) {
        if (skipRetired) return null;
        throw new Error(RETIRED_LESSON_MESSAGE);
      }
      return readLearningDocument(raw);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return null;
      throw new Error("Cannot load document " + id + ": " + String(error));
    }
  }
  async list(limit = 5000): Promise<LearningDocument[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await listVideoDocuments(this.root);
    const documents = await Promise.all(
      entries.map(({ id, path }) => this.readDocument(id, path, true)),
    );
    return documents
      .filter((value): value is LearningDocument => value !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(limit, 5000));
  }

  /** The only intentional mutation of a finished lesson: calibrated playback, never source cues. */
  async updatePlaybackRange(
    id: string,
    cueId: string,
    range: PlaybackOverride | null,
  ): Promise<LearningDocument> {
    return this.updateCalibratedRange(id, cueId, range, "cue");
  }
  async updateScenePlaybackRange(
    id: string,
    sceneId: string,
    range: PlaybackOverride | null,
  ): Promise<LearningDocument> {
    return this.updateCalibratedRange(id, sceneId, range, "scene");
  }
  private async updateCalibratedRange(
    id: string,
    targetId: string,
    range: PlaybackOverride | null,
    kind: "cue" | "scene",
  ): Promise<LearningDocument> {
    const safe = safeId(id);
    const prior = this.locks.get(safe) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const lock = prior.then(() => pending);
    this.locks.set(safe, lock);
    await prior;
    try {
      const document = await this.get(safe);
      if (!document) throw new Error("Saved document not found");
      if (
        kind === "cue" &&
        (!document.cues.some(cue => cue.id === targetId) ||
          !document.sections.some(scene => scene.cueIds.includes(targetId)))
      ) {
        throw new Error("Playback cue is not part of this lesson");
      }
      if (kind === "scene" && !document.sections.some(scene => scene.id === targetId)) {
        throw new Error("Playback scene is not part of this lesson");
      }
      const field = kind === "cue" ? "playbackOverrides" : "scenePlaybackOverrides";
      const overrides = { ...document[field] };
      if (range) overrides[targetId] = range;
      else delete overrides[targetId];
      const updated = readLearningDocument(
        kind === "cue"
          ? withSentenceTiming(document, targetId, range)
          : { ...document, [field]: overrides },
      );
      if (updated.schemaVersion !== document.schemaVersion)
        throw new Error("Playback update changed document schema");
      const path = await this.documentPath(safe);
      if (!path) throw new Error("Saved document not found");
      await atomicWrite(path, JSON.stringify(updated, null, 2) + "\n");
      await atomicWrite(path.slice(0, -5) + ".md", learningDocumentToMarkdown(updated));
      return updated;
    } finally {
      release();
      if (this.locks.get(safe) === lock) this.locks.delete(safe);
    }
  }

  async save(document: LearningDocument, markdown: string): Promise<void> {
    if (!currentLearningExecution(document.execution)) throw new Error(RETIRED_LESSON_MESSAGE);
    document = readLearningDocument(document);
    const id = safeId(document.id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (await this.get(id))
      throw new Error("Document already exists; refusing to overwrite existing learning material");
    // Commit canonical JSON last. A crash before that point can safely retry
    // both files; a crash afterward leaves a complete lesson for resume.
    const folder = await videoFolder(this.root, document);
    await atomicWrite(join(folder, id + ".md"), markdown);
    await atomicWrite(join(folder, id + ".json"), JSON.stringify(document, null, 2) + "\n");
  }
}

export function localStoragePorts(root = join(defaultDocumentsFolder(), "data-v7")): StoragePorts {
  return { jobs: new FileJobRepository(root), documents: new FileDocumentRepository(root) };
}
