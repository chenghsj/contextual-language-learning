import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

export const siriResourceRoot =
  "/System/Library/AssetsV2/com_apple_MobileAsset_UAF_Siri_TextToSpeech/purpose_auto";
const exec = promisify(execFile);

/** Siri assets are system-owned; do not grant them lesson-storage write access. */
export async function validateSiriResourceFolder(directory: string, root = siriResourceRoot) {
  const [base, folder] = await Promise.all([realpath(root), realpath(directory)]);
  const child = relative(base, folder);
  if (!child || child.includes(sep) || child === ".." || !child.endsWith(".asset"))
    throw new Error("Invalid Siri resource folder.");
  if (!(await stat(folder)).isDirectory()) throw new Error("Invalid Siri resource folder.");
  const [data, manifest] = await Promise.all([
    realpath(join(folder, "AssetData")),
    realpath(join(folder, "Info.plist")),
  ]);
  if (
    data !== join(folder, "AssetData") ||
    manifest !== join(folder, "Info.plist") ||
    !(await stat(data)).isDirectory() ||
    !(await stat(manifest)).isFile()
  )
    throw new Error("Invalid Siri resource folder.");
  return folder;
}

export async function openSiriResourceFolder(directory: string) {
  const folder = await validateSiriResourceFolder(directory);
  await exec("/usr/bin/open", [folder], { timeout: 15_000, maxBuffer: 8192 });
  return folder;
}
