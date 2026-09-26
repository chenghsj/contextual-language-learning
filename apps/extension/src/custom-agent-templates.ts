import type { CustomAgentDefinition } from "@immersive/core";

export interface CustomAgentTemplate {
  id: "gemini" | "opencode";
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
    promptMode: "argument",
    outputMode: "stdout-json",
    timeoutSeconds: 180,
  },
}, {
  id: "opencode",
  definition: {
    id: "custom-opencode",
    label: "OpenCode",
    executable: "opencode",
    args: ["run", "--format", "json", "{prompt}"],
    modelArgument: "--model",
    responsePath: "part.text",
    promptMode: "argument",
    outputMode: "ndjson-text",
    timeoutSeconds: 180,
  },
}];
