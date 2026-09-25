import { profileEnvironment } from "./process";
import { parseAgentJson } from "./json";
import type { AgentAdapter } from "./types";

export const agyAdapter: AgentAdapter = {
  id: "agy",
  label: "AGY",
  executableName: "agy",
  supportsAccountProfiles: false,
  configureEnvironment: settings => profileEnvironment(settings, null),
  async generate({ prompt, modelId, run }) {
    const model = modelId.trim() ? ["--model", modelId.trim()] : [];
    const response: unknown = parseAgentJson(await run(["-p", prompt, "--output-format", "json", "--sandbox", ...model]), "AGY");
    if (!response || typeof response !== "object") throw new Error("Unexpected AGY CLI output");
    const data = response as Record<string, unknown>;
    if (data.status !== "SUCCESS") throw new Error(String(data.error ?? "AGY did not complete successfully"));
    const payload = data.structured_output ?? data.response;
    return parseAgentJson(payload, "AGY");
  },
};
