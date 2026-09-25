import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { appConfigRoot, defaultDocumentsFolder } from "../platform/paths";
import { pickFolder } from "../platform/folder-picker";

const allowedFile = () => join(appConfigRoot(), "allowed-folders.json");
export const defaultDocumentFolder = defaultDocumentsFolder();

async function allowedFolders(): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(allowedFile(), "utf8"));
    return Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : [];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new Error("Cannot load allowed storage folders");
  }
}

export async function validateFolder(directory: string | undefined): Promise<string> {
  if (!directory) {
    await mkdir(defaultDocumentFolder, { recursive: true, mode: 0o700 });
    return realpath(defaultDocumentFolder);
  }
  if (!isAbsolute(directory)) throw new Error("Local storage directory must be absolute");
  const normalized = await realpath(resolve(directory));
  const defaultPath = await validateFolder(undefined);
  if (normalized !== defaultPath && !(await allowedFolders()).includes(normalized)) {
    throw new Error("This directory has not been selected using the folder picker");
  }
  if (!(await stat(normalized)).isDirectory()) throw new Error("Selected local path is not a directory");
  await access(normalized, constants.W_OK);
  return normalized;
}

export async function chooseLocalFolder(): Promise<string> {
  const directory = await realpath(await pickFolder());
  if (!(await stat(directory)).isDirectory()) throw new Error("Selected path is not a directory");
  await access(directory, constants.W_OK);
  const paths = await allowedFolders();
  if (!paths.includes(directory)) {
    await mkdir(appConfigRoot(), { recursive: true, mode: 0o700 });
    await writeFile(allowedFile(), JSON.stringify([...paths, directory], null, 2), { mode: 0o600 });
  }
  return directory;
}
