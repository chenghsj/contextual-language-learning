import { profileEnvironment } from "./process";
import { parseAgentJson } from "./json";
import type { AgentAdapter } from "./types";

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  label: "Claude Code",
  executableName: "claude",
  supportsAccountProfiles: true,
  configureEnvironment: settings => profileEnvironment(settings, "CLAUDE_CONFIG_DIR"),
  async generate({ prompt, modelId, run }) {
    const model = modelId.trim() ? ["--model", modelId.trim()] : [];
    const output = await run(["-p", prompt, "--output-format", "json", "--max-turns", "1", "--tools", "", ...model]);
    const response: unknown = parseAgentJson(output, "Claude");
    if (!response || typeof response !== "object") throw new Error("Unexpected Claude CLI output");
    const data = response as Record<string, unknown>;
    const payload = data.structured_output ?? data.result ?? data;
    return parseAgentJson(payload, "Claude");
  },
};
