import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Platform strategy: keep the existing macOS folders; use native user-data directories elsewhere. */
export function appConfigRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  switch (platform) {
    case "darwin": return join(home, "Library", "Application Support", "Immersive Learning");
    case "win32": return join(env.APPDATA || join(home, "AppData", "Roaming"), "Immersive Learning");
    case "linux": {
      const config = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
        ? env.XDG_CONFIG_HOME : join(home, ".config");
      return join(config, "immersive-language-learning");
    }
    default: throw new Error("Unsupported Native Host platform: " + platform);
  }
}

export function defaultDocumentsFolder(home: string = homedir()): string {
  return join(home, "Documents", "Immersive Learning");
}
