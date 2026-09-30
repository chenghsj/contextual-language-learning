/** User-imported CLI labels come from the Native Host registry, not a provider preset. */
export function agentDisplayName(provider: string, reportedLabel?: string): string {
  return reportedLabel?.trim() || provider;
}

/** Never guess a CLI's effective model when its model ID is blank. */
export function modelDisplayName(
  modelId: string,
  available: readonly { id: string; label: string }[],
  cliDefaultLabel: string,
): string {
  if (!modelId.trim()) return cliDefaultLabel;
  const selected = available.find(model => model.id === modelId);
  return selected?.label?.trim() || modelId;
}
