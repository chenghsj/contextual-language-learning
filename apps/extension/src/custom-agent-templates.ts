import type { CustomAgentDefinition } from "@immersive/core";

export interface CustomAgentTemplate {
  id: "gemini";
  definition: CustomAgentDefinition;
}

/**
 * Starter presets only. The executable is still resolved locally and must pass
 * the Native Host check before it can be used.
 *
 * Gemini CLI documents -p/--prompt, --output-format json and --model.
 * Its JSON mode wraps assistant text in the response field.
 */
export const CUSTOM_AGENT_TEMPLATES: readonly CustomAgentTemplate[] = [{
  id: "gemini",
  definition: {
    id: "custom-gemini",
    label: "Gemini CLI",
    executable: "gemini",
    args: ["-p", "{prompt}", "--output-format", "json"],
    modelArgument: "--model",
    responsePath: "response",
  },
}];
