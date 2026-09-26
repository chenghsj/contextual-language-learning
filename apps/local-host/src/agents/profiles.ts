import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { appConfigRoot } from "../platform/paths";
import { z } from "zod";
import type { AgentProfile } from "@immersive/core";
import { resolveAgentAdapter } from "../agents";

const registryRoot = () => appConfigRoot();
const registryFile = () => join(registryRoot(), "agent-profiles.json");
const profileSchema = z.array(z.object({
  id: z.string().uuid(),
  provider: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  label: z.string().min(1).max(80),
  directory: z.string().min(1).max(1024),
})).max(30);

export async function listAgentProfiles(): Promise<AgentProfile[]> {
  try {
    return profileSchema.parse(JSON.parse(await readFile(registryFile(), "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new Error("Cannot load saved Agent profiles. Check the local profile registry.");
  }
}

/** Save names and paths only. Never read, copy, export or serialize CLI credentials. */
export async function saveAgentProfile(provider: string, label: string, directory: string): Promise<AgentProfile[]> {
  const adapter = await resolveAgentAdapter(provider);
  if (!adapter.supportsAccountProfiles) throw new Error("This Agent has no isolated CLI profile support.");
  const name = label.trim();
  if (!name || name.length > 80) throw new Error("Profile name must be 1–80 characters.");
  if (!isAbsolute(directory)) throw new Error("Profile directory must be an absolute path inside your home folder.");
  const actual = await realpath(resolve(directory));
  const home = await realpath(homedir());
  if (!actual.startsWith(home + sep) || !(await stat(actual)).isDirectory()) {
    throw new Error("Profile directory must already exist inside your home folder.");
  }
  const saved = await listAgentProfiles();
  const existing = saved.find(item => item.provider === provider && item.directory === actual);
  if (!existing && saved.length >= 30) throw new Error("Too many saved Agent profiles.");
  const next: AgentProfile[] = existing
    ? saved.map(item => item.id === existing.id ? { ...item, label: name } : item)
    : [...saved, { id: randomUUID(), provider, label: name, directory: actual }];
  await writeProfiles(next);
  return next;
}

export async function removeAgentProfile(id: string): Promise<AgentProfile[]> {
  if (!z.string().uuid().safeParse(id).success) throw new Error("Invalid profile ID.");
  const saved = await listAgentProfiles();
  const next = saved.filter(profile => profile.id !== id);
  if (next.length !== saved.length) await writeProfiles(next);
  return next; // Only remove the registry entry, never the CLI directory or login.
}

async function writeProfiles(profiles: AgentProfile[]): Promise<void> {
  const root = registryRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = join(root, "agent-profiles." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(profiles, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, registryFile());
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
