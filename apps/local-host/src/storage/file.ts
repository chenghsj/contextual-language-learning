import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  JobSnapshotSchema, StudyProgressSchema, readLearningDocument,
  type JobSnapshot, type JobSummary, type LearningDocument, type StudyProgress,
} from "@immersive/core";
import type { DocumentRepository, JobRepository, ProgressRepository, StoragePorts } from "./ports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeId(id: string): string {
  if (!UUID.test(id)) throw new Error("Invalid repository ID");
  return id;
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
  constructor(root: string) { this.folder = join(root, "jobs"); }

  private filename(id: string): string { return join(this.folder, safeId(id) + ".json"); }

  async get(id: string): Promise<JobSnapshot | null> {
    try {
      return JobSnapshotSchema.parse(JSON.parse(await readFile(this.filename(id), "utf8")) as unknown);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw new Error("Cannot load saved job " + id + ": " + String(error));
    }
  }

  async create(job: JobSnapshot): Promise<void> {
    const valid = JobSnapshotSchema.parse(job);
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const filename = this.filename(valid.summary.id);
    if (await this.get(valid.summary.id)) throw new Error("This job ID already exists");
    await atomicWrite(filename, JSON.stringify(valid, null, 2) + "\n");
  }

  async list(limit = 50): Promise<JobSummary[]> {
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.folder)).filter(name => UUID.test(name.replace(/\.json$/, "")) && name.endsWith(".json"));
    const items = await Promise.all(names.map(async name => {
      const id = name.slice(0, -5);
      const job = await this.get(id);
      return job?.summary ?? null;
    }));
    return items.filter((item): item is JobSummary => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(limit, 5000));
  }

  async update(id: string, change: (current: JobSnapshot) => JobSnapshot): Promise<JobSnapshot> {
    const prior = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const lock = prior.then(() => pending);
    this.locks.set(id, lock);
    await prior;
    try {
      const current = await this.get(id);
      if (!current) throw new Error("Job does not exist: " + id);
      const updated = JobSnapshotSchema.parse(change(current));
      if (updated.summary.id !== id) throw new Error("Job identity cannot change");
      await atomicWrite(this.filename(id), JSON.stringify(updated, null, 2) + "\n");
      return updated;
    } finally {
      release();
      if (this.locks.get(id) === lock) this.locks.delete(id);
    }
  }
}

export class FileDocumentRepository implements DocumentRepository {
  constructor(private readonly root: string) {}
  async get(id: string): Promise<LearningDocument | null> {
    try {
      return readLearningDocument(JSON.parse(await readFile(join(this.root, safeId(id) + ".json"), "utf8")) as unknown);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw new Error("Cannot load document " + id + ": " + String(error));
    }
  }
  async list(limit = 5000): Promise<LearningDocument[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = (await readdir(this.root))
      .filter(name => name.endsWith(".json") && UUID.test(name.slice(0, -5)));
    const documents = await Promise.all(entries.map(name => this.get(name.slice(0, -5))));
    return documents.filter((value): value is LearningDocument => value !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(limit, 5000));
  }

  async save(document: LearningDocument, markdown: string): Promise<void> {
    const id = safeId(document.id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (await this.get(id)) throw new Error("Document already exists; refusing to overwrite existing learning material");
    // JSON is the canonical document. Markdown is a convenience export and can be repaired.
    await atomicWrite(join(this.root, id + ".json"), JSON.stringify(document, null, 2) + "\n");
    await atomicWrite(join(this.root, id + ".md"), markdown);
  }
}

export class FileProgressRepository implements ProgressRepository {
  private readonly folder: string;
  constructor(root: string) { this.folder = join(root, "progress"); }
  async get(id: string): Promise<StudyProgress | null> {
    try {
      return StudyProgressSchema.parse(JSON.parse(await readFile(join(this.folder, safeId(id) + ".json"), "utf8")) as unknown);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw new Error("Cannot load study progress: " + String(error));
    }
  }
  async save(progress: StudyProgress): Promise<void> {
    const valid = StudyProgressSchema.parse(progress);
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    await atomicWrite(join(this.folder, safeId(valid.documentId) + ".json"), JSON.stringify(valid, null, 2) + "\n");
  }
}

export function localStoragePorts(root = join(homedir(), "Documents", "Immersive Learning")): StoragePorts {
  return {
    jobs: new FileJobRepository(root),
    documents: new FileDocumentRepository(root),
    progress: new FileProgressRepository(root),
  };
}
