import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const exec = promisify(execFile);
const appRoot = join(homedir(), "Library", "Application Support", "Immersive Learning");
const allowedFile = join(appRoot, "allowed-folders.json");
export const defaultDocumentFolder = join(homedir(), "Documents", "Immersive Learning");

async function allowedFolders(): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(allowedFile, "utf8"));
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
  if (!directory.startsWith("/")) throw new Error("Local storage directory must be absolute");
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
  if (process.platform !== "darwin") throw new Error("Native folder picker currently supports macOS");
  // Constant AppleScript: no user-provided string is executed or interpolated.
  const script = 'POSIX path of (choose folder with prompt "選擇教材儲存資料夾")';
  let stdout: string;
  try {
    ({ stdout } = await exec("/usr/bin/osascript", ["-e", script], { timeout: 120_000, maxBuffer: 8192 }));
  } catch (error) {
    if (error && typeof error === "object" && "stderr" in error && String(error.stderr).includes("-128")) {
      throw new Error("已取消選擇資料夾");
    }
    throw new Error("無法開啟 macOS 資料夾選擇器");
  }
  const directory = await realpath(stdout.trim());
  if (!(await stat(directory)).isDirectory()) throw new Error("Selected path is not a directory");
  await access(directory, constants.W_OK);
  const paths = await allowedFolders();
  if (!paths.includes(directory)) {
    await mkdir(appRoot, { recursive: true, mode: 0o700 });
    await writeFile(allowedFile, JSON.stringify([...paths, directory], null, 2), { mode: 0o600 });
  }
  return directory;
}
