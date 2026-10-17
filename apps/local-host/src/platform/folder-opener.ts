import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateFolder } from "../storage/folders";

const exec = promisify(execFile);
type FolderRunner = (
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; windowsHide: boolean },
) => Promise<unknown>;

/** Open only a validated lesson destination, passing its path without a shell. */
export async function openLocalFolder(
  directory: string | undefined,
  platform: NodeJS.Platform = process.platform,
  run: FolderRunner = exec,
  resolveFolder: typeof validateFolder = validateFolder,
): Promise<string> {
  const command =
    platform === "darwin"
      ? "/usr/bin/open"
      : platform === "win32"
        ? "explorer.exe"
        : platform === "linux"
          ? "xdg-open"
          : null;
  if (!command) throw new Error("Opening folders is not available on " + platform);
  const folder = await resolveFolder(directory);
  await run(command, [folder], { timeout: 30_000, maxBuffer: 8192, windowsHide: true });
  return folder;
}
