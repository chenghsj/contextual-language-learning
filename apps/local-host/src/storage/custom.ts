import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CustomDocumentSchema,
  CustomJobSnapshotSchema,
  type CustomDocument,
  type CustomJobSnapshot,
} from "@immersive/core";

export const customStorageRoot = () =>
  join(homedir(), "Documents", "Immersive Learning", "custom-v1");
const safeId = (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Invalid custom repository ID");
  return id;
};
export const contentHash = (text: string) => createHash("sha256").update(text).digest("hex");
async function atomic(path: string, content: string) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(content, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
async function missing<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export interface CustomRepository {
  getJob(id: string): Promise<CustomJobSnapshot | null>;
  createJob(job: CustomJobSnapshot): Promise<void>;
  updateJob(
    id: string,
    change: (job: CustomJobSnapshot) => CustomJobSnapshot,
  ): Promise<CustomJobSnapshot>;
  listJobs(): Promise<CustomJobSnapshot[]>;
  getDocument(id: string): Promise<CustomDocument | null>;
  listDocuments(): Promise<CustomDocument[]>;
  saveDocument(document: CustomDocument): Promise<void>;
  renameDocument(id: string, title: string): Promise<void>;
  deleteDocument(id: string): Promise<void>;
}
/** Independent custom-v1 repository. Metadata commits only after the Markdown is durable. */
export class FileCustomRepository implements CustomRepository {
  private locks = new Map<string, Promise<void>>();
  constructor(readonly root = customStorageRoot()) {}
  private jobPath(id: string) {
    return join(this.root, "jobs", safeId(id) + ".json");
  }
  private documentPath(id: string) {
    return join(this.root, "documents", safeId(id));
  }
  private async lock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const queued = prior.catch(() => {}).then(() => pending);
    this.locks.set(id, queued);
    await prior.catch(() => {});
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(id) === queued) this.locks.delete(id);
    }
  }
  async getJob(id: string) {
    return missing(async () =>
      CustomJobSnapshotSchema.parse(JSON.parse(await readFile(this.jobPath(id), "utf8"))),
    );
  }
  async createJob(job: CustomJobSnapshot) {
    await this.lock("job:" + job.summary.id, async () => {
      const parsed = CustomJobSnapshotSchema.parse(job);
      await mkdir(join(this.root, "jobs"), { recursive: true, mode: 0o700 });
      if (await this.getJob(parsed.summary.id)) throw new Error("Custom job already exists");
      await atomic(this.jobPath(parsed.summary.id), JSON.stringify(parsed, null, 2));
    });
  }
  async updateJob(id: string, change: (job: CustomJobSnapshot) => CustomJobSnapshot) {
    return this.lock("job:" + id, async () => {
      const current = await this.getJob(id);
      if (!current) throw new Error("Custom job not found");
      const next = CustomJobSnapshotSchema.parse(change(current));
      if (next.summary.id !== id) throw new Error("Custom job identity cannot change");
      await atomic(this.jobPath(id), JSON.stringify(next, null, 2));
      return next;
    });
  }
  async listJobs() {
    await mkdir(join(this.root, "jobs"), { recursive: true, mode: 0o700 });
    const names = (await readdir(join(this.root, "jobs"))).filter(name =>
      /^[a-f0-9-]{36}\.json$/i.test(name),
    );
    const jobs = await Promise.all(names.map(name => this.getJob(name.slice(0, -5))));
    return jobs
      .filter((job): job is CustomJobSnapshot => job !== null)
      .sort((a, b) => b.summary.updatedAt.localeCompare(a.summary.updatedAt));
  }
  async getDocument(id: string) {
    return missing(async () => {
      const folder = this.documentPath(id);
      const metadata = JSON.parse(await readFile(join(folder, "metadata.json"), "utf8"));
      const markdown = await readFile(join(folder, "content.md"), "utf8");
      if (metadata.markdownHash !== contentHash(markdown))
        throw new Error("Custom Markdown does not match committed metadata");
      return CustomDocumentSchema.parse({ ...metadata, markdown });
    });
  }
  async listDocuments() {
    await mkdir(join(this.root, "documents"), { recursive: true, mode: 0o700 });
    const ids = (await readdir(join(this.root, "documents"))).filter(id =>
      /^[a-f0-9-]{36}$/i.test(id),
    );
    const docs = await Promise.all(ids.map(id => this.getDocument(id)));
    return docs
      .filter((doc): doc is CustomDocument => doc !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async saveDocument(document: CustomDocument) {
    await this.lock("doc:" + document.id, async () => {
      const parsed = CustomDocumentSchema.parse(document);
      const existing = await this.getDocument(parsed.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(parsed))
          throw new Error("Custom document conflicts with saved content");
        return;
      }
      const folder = this.documentPath(parsed.id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const { markdown, ...metadata } = parsed;
      await atomic(join(folder, "content.md"), markdown);
      await atomic(
        join(folder, "metadata.json"),
        JSON.stringify({ ...metadata, markdownHash: contentHash(markdown) }, null, 2),
      );
    });
  }
  async renameDocument(id: string, title: string) {
    await this.lock("doc:" + id, async () => {
      const doc = await this.getDocument(id);
      if (!doc) throw new Error("Custom document not found");
      const { markdown, ...metadata } = CustomDocumentSchema.parse({ ...doc, title });
      await atomic(
        join(this.documentPath(id), "metadata.json"),
        JSON.stringify({ ...metadata, markdownHash: contentHash(markdown) }, null, 2),
      );
    });
  }
  async deleteDocument(id: string) {
    await this.lock("doc:" + id, () => rm(this.documentPath(id), { recursive: true, force: true }));
  }
}
