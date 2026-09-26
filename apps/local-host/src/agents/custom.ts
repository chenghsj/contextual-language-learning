import type { CustomAgentDefinition } from "@immersive/core";
import { parseAgentJson } from "./json";
import { profileEnvironment, resolveConfiguredExecutable } from "./process";
import type { AgentAdapter } from "./types";

export function expandCustomArgs(
  definition: CustomAgentDefinition, prompt: string, modelId: string,
): string[] {
  let usedPrompt = false;
  let usedModel = false;
  const args = definition.args.map(arg => {
    if (arg.includes("{prompt}")) {
      usedPrompt = true;
      return arg.replace("{prompt}", prompt);
    }
    if (arg.includes("{model}")) {
      usedModel = true;
      return arg.replace("{model}", modelId);
    }
    return arg;
  });
  if (!usedPrompt) args.push(prompt);
  if (modelId.trim() && !usedModel) {
    if (!definition.modelArgument) {
      throw new Error(definition.label + " has no model argument configured.");
    }
    args.push(definition.modelArgument, modelId.trim());
  }
  return args;
}

export function extractCustomAgentPayload(value: unknown, path?: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new Error("Custom Agent response is missing configured path: " + path);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? parseAgentJson(current, "Custom Agent response") : current;
}

export function customAgentAdapter(definition: CustomAgentDefinition): AgentAdapter {
  return {
    id: definition.id,
    label: definition.label,
    executableName: definition.executable,
    supportsAccountProfiles: false,
    custom: true,
    resolveExecutable: () => resolveConfiguredExecutable(definition.executable),
    configureEnvironment: settings => profileEnvironment(settings, null),
    async generate({ prompt, modelId, run }) {
      const output = await run(expandCustomArgs(definition, prompt, modelId));
      return extractCustomAgentPayload(parseAgentJson(output, definition.label), definition.responsePath);
    },
  };
}
