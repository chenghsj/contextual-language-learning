import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LearningDocumentSchema, type GenerationRequest, type LearningDocument } from "@immersive/core";
import { toMarkdown } from "../generation";

export interface ExistingDocument { id: string; title: string; createdAt: string; path: string }

function normalizeUrl(value: string | undefined): string {
  if (!value) return "";
  try { const url = new URL(value); url.hash = ""; return url.toString(); } catch { return value; }
}
export function sameSource(doc: LearningDocument, request: GenerationRequest): boolean {
  const a = normalizeUrl(doc.source.url), b = normalizeUrl(request.source.url);
  return a && b ? a === b : doc.source.platform === request.source.platform &&
    doc.source.title.trim().toLowerCase() === request.source.title.trim().toLowerCase();
}
export async function findExisting(root: string, request: GenerationRequest): Promise<ExistingDocument[]> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const results: ExistingDocument[] = [];
  for (const name of await readdir(root)) {
    if (!name.endsWith(".json")) continue;
    try {
      const doc = LearningDocumentSchema.parse(JSON.parse(await readFile(join(root, name), "utf8")) as unknown);
      if (sameSource(doc, request)) results.push({ id: doc.id, title: doc.source.title, createdAt: doc.createdAt, path: join(root, name) });
    } catch {}
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function publishDocument(root: string, doc: LearningDocument): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stem = "immersive-" + doc.id;
  await writeFile(join(root, stem + ".json"), JSON.stringify(doc, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(join(root, stem + ".md"), toMarkdown(doc), { flag: "wx", mode: 0o600 });
}
