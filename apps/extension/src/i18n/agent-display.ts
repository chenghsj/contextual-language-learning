/** UI-facing names; provider IDs and CLI commands remain unchanged. */
const KNOWN_AGENT_NAMES: Readonly<Record<string, string>> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  agy: "Antigravity CLI (agy)",
};

export function agentDisplayName(provider: string, reportedLabel?: string): string {
  return KNOWN_AGENT_NAMES[provider] ?? reportedLabel?.trim() ?? provider;
}

/** Never guess a CLI's effective model when the user left the model ID blank. */
export function modelDisplayName(
  modelId: string,
  available: readonly { id: string; label: string }[],
  cliDefaultLabel: string,
): string {
  if (!modelId.trim()) return cliDefaultLabel;
  const selected = available.find(model => model.id === modelId);
  return selected?.label?.trim() || modelId;
}
