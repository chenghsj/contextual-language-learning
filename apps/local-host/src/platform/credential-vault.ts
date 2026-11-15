import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class SecureCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureCredentialError";
  }
}
export interface CredentialVault {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}
export type VaultRunner = (
  command: string,
  args: string[],
  input: string,
) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;

// Never put secrets in argv, environment variables, temporary scripts or error objects.
export const runVaultCommand: VaultRunner = (command, args, input) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "",
      stderr = "",
      bytes = 0;
    const fail = () => {
      child.kill();
      reject(
        new SecureCredentialError(
          "Secure credential storage command failed. Check the local service installation and system credential store.",
        ),
      );
    };
    const timer = setTimeout(fail, 60_000);
    child.on("error", fail);
    child.stdin.on("error", () => {});
    for (const [stream, append] of [
      [
        child.stdout,
        (text: string) => {
          stdout += text;
        },
      ],
      [
        child.stderr,
        (text: string) => {
          stderr += text;
        },
      ],
    ] as const) {
      stream.setEncoding("utf8");
      stream.on("data", (text: string) => {
        bytes += Buffer.byteLength(text);
        if (bytes > 2_000_000) fail();
        else append(text);
      });
    }
    child.on("close", code => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });

// DPAPI owns the encryption key; the protect operation returns only ciphertext.
export const windowsProtectionScript = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  $entropy = [System.Text.Encoding]::UTF8.GetBytes('dev.contextual.language-learning.ai.v1')
  if ($request.action -eq 'protect') {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$request.value)
    $output = [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropy, $scope))
  } elseif ($request.action -eq 'unprotect') {
    $bytes = [Convert]::FromBase64String([string]$request.value)
    $output = [System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropy, $scope))
  } else { exit 1 }
  [Console]::Out.Write($output)
} catch { [Console]::Error.Write('Windows DPAPI credential storage failed.'); exit 1 }
`;

export function createSystemCredentialVault(
  root: string,
  options: {
    platform?: NodeJS.Platform;
    run?: VaultRunner;
    helperPath?: string;
  } = {},
): CredentialVault {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runVaultCommand;
  // Independent development/test roots cannot overwrite the installed product's vault.
  const account = createHash("sha256").update(resolve(root)).digest("hex");
  const service = "dev.contextual.language-learning.ai.v1";
  if (platform === "darwin") {
    const helper =
      options.helperPath ??
      fileURLToPath(
        new URL(
          import.meta.url.endsWith(".ts") ? "../../dist/macos-credentials" : "./macos-credentials",
          import.meta.url,
        ),
      );
    async function invoke(action: string, value?: string) {
      let result;
      try {
        result = await run(helper, [], JSON.stringify({ action, service, account, value }));
      } catch {
        throw new SecureCredentialError(
          "macOS Keychain helper is unavailable. Update the local service and retry.",
        );
      }
      if (result.code !== 0)
        throw new SecureCredentialError(
          "macOS Keychain is unavailable or access was denied. Unlock the login keychain and allow the local service, then retry.",
        );
      try {
        const parsed = JSON.parse(result.stdout);
        if (parsed.missing === true) return undefined;
        if (typeof parsed.value === "string") return parsed.value;
        throw new Error();
      } catch {
        throw new SecureCredentialError(
          "Invalid response from macOS credential storage. Update the local service.",
        );
      }
    }
    return {
      read: () => invoke("read"),
      write: async value => {
        await invoke("write", value);
      },
    };
  }
  if (platform === "win32") {
    const path = join(root, "credentials.dpapi");
    const executable = join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    async function crypt(action: string, value: string) {
      const result = await run(
        executable,
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(windowsProtectionScript, "utf16le").toString("base64"),
        ],
        JSON.stringify({ action, value }),
      );
      if (result.code !== 0 || !result.stdout)
        throw new SecureCredentialError(
          "Windows DPAPI credential storage is unavailable. Sign in with the Windows account that saved these credentials and retry.",
        );
      return result.stdout;
    }
    return {
      async read() {
        let encrypted: string;
        try {
          encrypted = await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw new SecureCredentialError("Unable to read Windows encrypted credentials.");
        }
        return crypt("unprotect", encrypted);
      },
      async write(value) {
        const encrypted = await crypt("protect", value);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted))
          throw new SecureCredentialError("Invalid Windows DPAPI response.");
        const temporary = join(dirname(path), `.credentials-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, encrypted, { mode: 0o600, flag: "wx", flush: true });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
      },
    };
  }
  if (platform === "linux") {
    const attributes = ["service", service, "account", account];
    const unavailable = () =>
      new SecureCredentialError(
        "Linux Secret Service is unavailable or locked. Install secret-tool (libsecret-tools), start a Secret Service provider such as GNOME Keyring, and unlock it before retrying. Credentials were not saved as plaintext.",
      );
    return {
      async read() {
        let result;
        try {
          result = await run("/usr/bin/secret-tool", ["lookup", ...attributes], "");
        } catch {
          throw unavailable();
        }
        if (result.code === 1 && !result.stdout && !result.stderr) return undefined;
        if (result.code !== 0 || !result.stdout) throw unavailable();
        return result.stdout;
      },
      async write(value) {
        let result;
        try {
          result = await run(
            "/usr/bin/secret-tool",
            ["store", "--label=Contextual Language Learning AI credentials", ...attributes],
            value,
          );
        } catch {
          throw unavailable();
        }
        if (result.code !== 0) throw unavailable();
      },
    };
  }
  throw new SecureCredentialError(
    "Secure AI credential storage is not supported on this platform.",
  );
}
