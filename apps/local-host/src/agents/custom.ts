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
      return parseAgentJson(output, definition.label);
    },
  };
}
