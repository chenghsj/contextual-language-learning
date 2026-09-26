import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { CustomAgentDefinitionSchema, type CustomAgentDefinition } from "@immersive/core";
import { z } from "zod";
import { appConfigRoot } from "../platform/paths";
import { resolveConfiguredExecutable } from "./process";

const file = () => join(appConfigRoot(), "custom-agents.json");
const registrySchema = z.array(CustomAgentDefinitionSchema).max(20);

export async function listCustomAgents(): Promise<CustomAgentDefinition[]> {
  try {
    return registrySchema.parse(JSON.parse(await readFile(file(), "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw new Error("Cannot load custom Agent definitions. Check the local Agent registry.");
  }
}

export async function findCustomAgent(id: string): Promise<CustomAgentDefinition | undefined> {
  return (await listCustomAgents()).find(agent => agent.id === id);
}

export async function saveCustomAgent(input: CustomAgentDefinition): Promise<CustomAgentDefinition[]> {
  const definition = CustomAgentDefinitionSchema.parse(input);
  const current = await listCustomAgents();
  const index = current.findIndex(agent => agent.id === definition.id);
  if (index < 0 && current.length >= 20) throw new Error("Too many custom Agents.");
  const next = index < 0
    ? [...current, definition]
    : current.map((agent, i) => i === index ? definition : agent);
  await writeRegistry(next);
  return next;
}

export async function removeCustomAgent(id: string): Promise<CustomAgentDefinition[]> {
  if (!/^custom-[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new Error("Invalid custom Agent ID.");
  const current = await listCustomAgents();
  const next = current.filter(agent => agent.id !== id);
  if (next.length !== current.length) await writeRegistry(next);
  return next;
}

export async function testCustomAgentExecutable(input: CustomAgentDefinition): Promise<string> {
  const definition = CustomAgentDefinitionSchema.parse(input);
  const executable = await resolveConfiguredExecutable(definition.executable);
  if (!executable) throw new Error(definition.label + " CLI was not found.");
  // Confirm the resolved file remains readable/executable at test time. No model request is made.
  await access(executable, process.platform === "win32" && /\.m?js$/i.test(executable) ? constants.R_OK : constants.X_OK);
  return executable;
}

async function writeRegistry(definitions: CustomAgentDefinition[]): Promise<void> {
  const root = appConfigRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = join(root, "custom-agents." + randomUUID() + ".tmp");
  try {
    await writeFile(temporary, JSON.stringify(definitions, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, file());
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
