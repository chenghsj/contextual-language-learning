import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const dialogTimeout = 120_000;

/** Strategy functions are selected once per folder request; arguments are fixed, never user-supplied shell. */
export async function pickFolder(platform: NodeJS.Platform = process.platform): Promise<string> {
  if (platform === "darwin") {
    try {
      const { stdout } = await exec("/usr/bin/osascript", [
        "-e", 'POSIX path of (choose folder with prompt "Select lesson storage folder")',
      ], { timeout: dialogTimeout, maxBuffer: 8192 });
      return stdout.trim();
    } catch (error) {
      if (String((error as { stderr?: unknown }).stderr ?? "").includes("-128")) {
        throw new Error("Folder selection cancelled.");
      }
      throw new Error("Could not open the macOS folder picker.");
    }
  }
  if (platform === "win32") {
    // Static PowerShell, not interpolated with user content. -Sta is needed for WinForms dialogs.
    const script = [
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Select lesson storage folder'",
      "$dialog.ShowNewFolderButton = $true",
      "if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }",
      "[Console]::Write($dialog.SelectedPath)",
    ].join("; ");
    try {
      const { stdout } = await exec("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Sta", "-Command", script,
      ], { timeout: dialogTimeout, maxBuffer: 8192, windowsHide: true });
      return stdout.trim();
    } catch (error) {
      if ((error as { code?: unknown }).code === 2) throw new Error("Folder selection cancelled.");
      throw new Error("Could not open Windows folder picker. Windows PowerShell 5.1 is required.");
    }
  }
  if (platform === "linux") {
    for (const [command, args] of [
      ["zenity", ["--file-selection", "--directory", "--title=Select lesson storage folder"]],
      ["kdialog", ["--getexistingdirectory"]],
    ] as const) {
      try {
        const { stdout } = await exec(command, [...args], { timeout: dialogTimeout, maxBuffer: 8192 });
        if (!stdout.trim()) throw new Error("Folder selection cancelled.");
        return stdout.trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        if ((error as { code?: unknown }).code === 1) throw new Error("Folder selection cancelled.");
        throw new Error("Could not open the Linux folder picker (" + command + ").");
      }
    }
    throw new Error("Install zenity or kdialog to choose a local folder on Linux.");
  }
  throw new Error("Folder picker is not available on " + platform);
}
