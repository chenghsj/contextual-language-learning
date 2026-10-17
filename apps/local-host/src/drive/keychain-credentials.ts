import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export const DRIVE_KEYCHAIN_SERVICE = "dev.contextual.language-learning.google-drive";
export const LEGACY_DRIVE_KEYCHAIN_SERVICE = "dev.immersive.language-learning.google-drive";

type Run = (
  command: string,
  args: string[],
  options: { maxBuffer: number },
) => Promise<{ stdout: string }>;

export function createDriveKeychainStore(
  run: Run = exec,
  platform: NodeJS.Platform = process.platform,
) {
  function requireKeychain(): void {
    if (platform !== "darwin")
      throw new Error("Google account storage currently requires macOS Keychain");
  }
  async function write(id: string, token: string): Promise<void> {
    requireKeychain();
    await run(
      "/usr/bin/security",
      ["add-generic-password", "-s", DRIVE_KEYCHAIN_SERVICE, "-a", id, "-w", token, "-U"],
      { maxBuffer: 4096 },
    );
  }
  async function read(id: string): Promise<string> {
    requireKeychain();
    const lookup = (service: string) =>
      run("/usr/bin/security", ["find-generic-password", "-s", service, "-a", id, "-w"], {
        maxBuffer: 16_384,
      });
    try {
      return (await lookup(DRIVE_KEYCHAIN_SERVICE)).stdout.trim();
    } catch (error) {
      // Exit 44 means item not found. Do not fall back after a denied Keychain prompt.
      if ((error as { code?: unknown }).code !== 44)
        throw new Error("此 Google 帳號的憑證無法讀取，請確認 Keychain 權限或重新連線");
      try {
        const token = (await lookup(LEGACY_DRIVE_KEYCHAIN_SERVICE)).stdout.trim();
        await write(id, token);
        return token;
      } catch {
        throw new Error("此 Google 帳號的憑證已失效，請重新連線");
      }
    }
  }
  async function remove(id: string): Promise<void> {
    if (platform !== "darwin") return;
    for (const service of [DRIVE_KEYCHAIN_SERVICE, LEGACY_DRIVE_KEYCHAIN_SERVICE]) {
      await run("/usr/bin/security", ["delete-generic-password", "-s", service, "-a", id], {
        maxBuffer: 4096,
      }).catch(() => undefined);
    }
  }
  return { read, write, remove };
}
