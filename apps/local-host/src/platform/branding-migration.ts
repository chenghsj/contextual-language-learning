import {
  copyFileSync,
  linkSync,
  rmSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  constants,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { appConfigRoot, defaultDocumentsFolder } from "./paths";

const marker = ".contextual-branding-migrated";

/** Copy once; keep the original as a recovery path and never overwrite newer data. */
export function migrateBrandingDirectory(
  source: string,
  target: string,
  excluded: string[] = [],
): void {
  if (!existsSync(source) || existsSync(join(target, marker))) return;
  if (!lstatSync(source).isDirectory() || (existsSync(target) && !lstatSync(target).isDirectory()))
    throw new Error("Branding migration requires real directories: " + source + " -> " + target);
  function copy(from: string, to: string): void {
    const entry = lstatSync(from);
    if (entry.isSymbolicLink())
      throw new Error("Branding migration cannot copy a symbolic link: " + from);
    if (entry.isDirectory()) {
      if (existsSync(to) && !lstatSync(to).isDirectory())
        throw new Error("Branding migration path conflict: " + to);
      mkdirSync(to, { recursive: true, mode: entry.mode & 0o777 });
      for (const name of readdirSync(from)) copy(join(from, name), join(to, name));
    } else if (entry.isFile()) {
      if (existsSync(to)) {
        if (!lstatSync(to).isFile() || !readFileSync(from).equals(readFileSync(to)))
          throw new Error(
            "Branding migration found different files at: " +
              to +
              ". Both copies are preserved; resolve the conflict before retrying.",
          );
      } else {
        const temporary = to + "." + randomUUID() + ".migration.tmp";
        try {
          copyFileSync(from, temporary, constants.COPYFILE_EXCL);
          try {
            linkSync(temporary, to);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            copy(from, to);
          }
        } finally {
          rmSync(temporary, { force: true });
        }
      }
    } else throw new Error("Branding migration cannot copy this file: " + from);
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(source)) {
    if (name !== marker && !excluded.includes(name)) copy(join(source, name), join(target, name));
  }
  try {
    writeFileSync(join(target, marker), "Legacy data copied; original files retained.\n", {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export function migrateBrandingData(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): void {
  const config = appConfigRoot(platform, env, home);
  const oldConfig =
    platform === "linux"
      ? join(config, "..", "immersive-language-learning")
      : join(config, "..", "Immersive Learning");
  migrateBrandingDirectory(oldConfig, config, ["native-host"]);
  // Custom documents keep their independent compatibility path. Retired standard
  // lessons are left at their original location, without copying or converting them.
  migrateBrandingDirectory(
    join(home, "Documents", "Immersive Learning", "custom-v1"),
    join(defaultDocumentsFolder(home), "custom-v1"),
  );
}
