import type { AgentModel, DiscoveredModel } from "@contextual/core";

/** Keep SDK capabilities authoritative; directory-only choices require an explicit custom selection. */
export function searchableModelOptions(
  models: AgentModel[],
  directory: DiscoveredModel[],
  customIds: string[],
) {
  const options = new Map<string, AgentModel>();
  const names = new Map(directory.map(model => [model.id, model.label]));
  for (const model of models)
    options.set(model.id, {
      ...model,
      label: model.custom ? (names.get(model.id) ?? model.label) : model.label,
    });
  for (const model of directory) {
    if (options.has(model.id) || (model.catalogId && options.has(model.catalogId))) continue;
    options.set(model.id, {
      id: model.id,
      label: model.label,
      custom: true,
      thinkingLevels: ["off"],
      availability: "unknown",
    });
  }
  for (const id of customIds)
    if (!options.has(id))
      options.set(id, {
        id,
        label: names.get(id) ?? id,
        custom: true,
        thinkingLevels: ["off"],
        availability: "unknown",
      });
  const result = [...options.values()];
  const labels = new Map<string, number>();
  for (const model of result) labels.set(model.label, (labels.get(model.label) ?? 0) + 1);
  return result.map(model =>
    (labels.get(model.label) ?? 0) > 1
      ? { ...model, label: `${model.label} (${model.id})` }
      : model,
  );
}
