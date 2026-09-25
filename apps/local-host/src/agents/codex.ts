import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { profileEnvironment } from "./process";
import type { AgentAdapter } from "./types";

export const codexAdapter: AgentAdapter = {
  id: "codex",
  label: "Codex",
  executableName: "codex",
  supportsAccountProfiles: true,
  configureEnvironment: settings => profileEnvironment(settings, "CODEX_HOME"),
  async generate({ prompt, modelId, workDir, run }) {
    const messagePath = join(workDir, "last-message.json");
    const model = modelId.trim() ? ["--model", modelId.trim()] : [];
    await run(["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--output-last-message", messagePath, ...model, prompt]);
    return JSON.parse((await readFile(messagePath, "utf8")).trim());
  },
};
