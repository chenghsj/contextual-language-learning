import { access, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LearningDocument } from "@immersive/core";
import { videoFolderName } from "../duplicates";

/** Keep one readable folder per source even if a later generation changes its title. */
export async function videoFolder(root: string, document: LearningDocument): Promise<string> {
  const parent = join(root, "videos");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const name = videoFolderName(document.source, document.cues);
  const suffix = name.slice(name.lastIndexOf("--"));
  const existing = (await readdir(parent, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.endsWith(suffix));
  if (existing.length > 1) throw new Error("Multiple local folders exist for the same video");
  const folder = join(parent, existing[0]?.name ?? name);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  return folder;
}

export async function findVideoDocument(root: string, id: string): Promise<string | null> {
  const parent = join(root, "videos");
  let folders;
  try { folders = await readdir(parent, { withFileTypes: true }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  let match: string | null = null;
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const path = join(parent, folder.name, id + ".json");
    try {
      await access(path);
      if (match) throw new Error("Document exists in multiple video folders: " + id);
      match = path;
    }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return match;
}

export async function listVideoDocumentIds(root: string): Promise<string[]> {
  const parent = join(root, "videos");
  let folders;
  try { folders = await readdir(parent, { withFileTypes: true }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const ids: string[] = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    for (const file of await readdir(join(parent, folder.name))) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i.test(file)) ids.push(file.slice(0, -5));
    }
  }
  return ids;
}
