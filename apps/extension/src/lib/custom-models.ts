import { CustomModelIdSchema, type AgentModel, type AgentSettings } from "@contextual/core";

/** The active selection persists independently; a full history must not prevent preferences saving. */
export function rememberCustomModelId(
  history: Record<string, string[]>,
  provider: string,
  id: string,
) {
  const saved = history[provider] ?? [];
  if (!CustomModelIdSchema.safeParse(id).success || saved.includes(id) || saved.length >= 50)
    return history;
  return { ...history, [provider]: [...saved, id] };
}

/** Keep an explicit custom selection usable while catalogs refresh or lag behind. */
export function selectedCustomModel(
  selected: Pick<AgentSettings, "modelId" | "customModel">,
  models: readonly AgentModel[],
): AgentModel | undefined {
  const known = models.find(model => model.id === selected.modelId);
  if (known || !selected.customModel || !CustomModelIdSchema.safeParse(selected.modelId).success)
    return known;
  return {
    id: selected.modelId,
    label: selected.modelId,
    thinkingLevels: ["off"],
    availability: "unknown",
  };
}
