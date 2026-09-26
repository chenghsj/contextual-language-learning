import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CustomAgentDefinition } from "@immersive/core";
import { parseAgentJson } from "./json";
import { profileEnvironment, resolveConfiguredExecutable } from "./process";
import type { AgentAdapter } from "./types";

export function expandCustomArgs(
  definition: CustomAgentDefinition, prompt: string, modelId: string, outputPath?: string,
): string[] {
  let usedPrompt = false;
  let usedModel = false;
  const promptMode = definition.promptMode ?? "argument";
  const args = definition.args.map(arg => {
    if (arg.includes("{prompt}")) {
      usedPrompt = true;
      return arg.replace("{prompt}", prompt);
    }
    if (arg.includes("{output}")) {
      if (!outputPath) throw new Error(definition.label + " requires an output file path.");
      return arg.replace("{output}", outputPath);
    }
    if (arg.includes("{model}")) {
      usedModel = true;
      return arg.replace("{model}", modelId);
    }
    return arg;
  });
  if (promptMode === "argument" && !usedPrompt) args.push(prompt);
  if (modelId.trim() && !usedModel) {
    if (!definition.modelArgument) {
      throw new Error(definition.label + " has no model argument configured.");
    }
    args.push(definition.modelArgument, modelId.trim());
  }
  return args;
}

function valueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new Error("Custom Agent response is missing configured path: " + path);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function extractCustomAgentPayload(value: unknown, path?: string): unknown {
  if (!path) return value;
  const current = valueAtPath(value, path);
  return typeof current === "string" ? parseAgentJson(current, "Custom Agent response") : current;
}

export function parseCustomAgentNdjson(output: string, path: string): unknown {
  const text: string[] = [];
  for (const line of output.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    let event: unknown;
    try { event = JSON.parse(line) as unknown; }
    catch { throw new Error("Custom Agent emitted invalid NDJSON."); }
    if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== "text") continue;
    const value = valueAtPath(event, path);
    if (typeof value === "string") text.push(value);
  }
  if (!text.length) throw new Error("Custom Agent NDJSON contained no text events.");
  return parseAgentJson(text.join(""), "Custom Agent NDJSON text");
}

export function customAgentAdapter(definition: CustomAgentDefinition): AgentAdapter {
  return {
    id: definition.id,
    label: definition.label,
    executableName: definition.executable,
    supportsAccountProfiles: !!definition.profileEnvVar,
    custom: true,
    resolveExecutable: () => resolveConfiguredExecutable(definition.executable),
    configureEnvironment: settings => profileEnvironment(settings, definition.profileEnvVar ?? null),
    async generate({ prompt, modelId, workDir, run }) {
      const outputMode = definition.outputMode ?? "stdout-json";
      const outputPath = outputMode === "file-json" ? join(workDir, "custom-agent-output.json") : undefined;
      const args = expandCustomArgs(definition, prompt, modelId, outputPath);
      const stdin = (definition.promptMode ?? "argument") === "stdin" ? prompt : undefined;
      const output = await run(args, stdin, (definition.timeoutSeconds ?? 180) * 1000);
      if (outputMode === "ndjson-text") {
        return parseCustomAgentNdjson(output, definition.responsePath!);
      }
      const raw = outputMode === "file-json" ? await readFile(outputPath!, "utf8") : output;
      return extractCustomAgentPayload(parseAgentJson(raw, definition.label), definition.responsePath);
    },
  };
}
