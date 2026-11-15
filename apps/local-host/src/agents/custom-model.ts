import { CustomModelIdSchema, type AgentSettings } from "@contextual/core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

/** An explicit model ID uses the existing provider transport and credentials. */
export async function selectedPiModel(
  settings: AgentSettings,
  available: readonly Model<Api>[],
  runtime: ModelRuntime,
): Promise<Model<Api> | undefined> {
  const known = settings.modelId
    ? available.find(model => model.id === settings.modelId)
    : available[0];
  if (known || !settings.customModel) return known;
  const id = CustomModelIdSchema.parse(settings.modelId);
  if (settings.provider === "local") throw new Error("Edit the local model connection settings.");
  if (!(await runtime.checkAuth(settings.provider)))
    throw new Error("Connect this AI provider in settings before generating.");
  const templates = runtime.getModels(settings.provider);
  // Multi-API services can route Claude and Gemini through different transports.
  // Reuse the matching family without importing prices or capabilities for a new ID.
  const family = id.split(/[/-]/)[0].toLowerCase();
  const template =
    templates.find(model => model.id.split(/[/-]/)[0].toLowerCase() === family) ?? templates[0];
  if (!template) throw new Error("This service does not provide a text generation transport.");
  return {
    ...template,
    id,
    name: id,
    // Unknown capabilities and prices must not inherit another model's advertised values.
    reasoning: false,
    thinkingLevelMap: undefined,
    contextWindow: Math.min(template.contextWindow, 128000),
    maxTokens: Math.min(template.maxTokens, 8192),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}
