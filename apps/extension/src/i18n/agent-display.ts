/** Provider labels come from the Host SDK catalog. */
export function agentDisplayName(provider: string, reportedLabel?: string): string {
  return reportedLabel?.trim() || provider;
}

/** Never guess a provider's effective model when its model ID is blank. */
export function modelDisplayName(
  modelId: string,
  available: readonly { id: string; label: string }[],
  automaticLabel: string,
): string {
  if (!modelId.trim()) return automaticLabel;
  const selected = available.find(model => model.id === modelId);
  return selected?.label?.trim() || modelId;
}
