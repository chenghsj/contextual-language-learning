import type { RefreshModelsContext, ModelsStoreEntry } from "@earendil-works/pi-ai";
import { DiscoveredModelSchema, type DiscoveredModel } from "@contextual/core";
import { getApiKey } from "pi-antigravity/src/auth/oauth.js";
import {
  fetchAvailableModelsCatalog,
  parseApiKey,
  DEFAULT_ENDPOINT,
} from "pi-antigravity/src/client/index.js";
import {
  ANTIGRAVITY_PERSIST_KEY,
  applyAntigravityCatalog,
  buildAntigravityCatalog,
  getCatalogRefreshIntervalMs,
  getCurrentAntigravityCatalog,
  hydrateAntigravityCatalog,
  isSelectableRuntimeModelId,
  snapshotDynamicModelEnums,
} from "pi-antigravity/src/models/index.js";
import { ANTIGRAVITY_API } from "pi-antigravity/src/stream/index.js";

/** A successful account catalog must not regain models or effort levels from static fallbacks. */
export const accountAntigravityCatalog = (
  raw: Parameters<typeof buildAntigravityCatalog>[0],
  current = getCurrentAntigravityCatalog(),
  agentModelSorts?: Parameters<typeof buildAntigravityCatalog>[2],
) => {
  if (!Object.entries(raw).some(([id, info]) => isSelectableRuntimeModelId(id, info)))
    return { models: [], routing: {} };
  return buildAntigravityCatalog(raw, { models: current.models, routing: {} }, agentModelSorts);
};

/** Read raw account candidates, including models outside the curated recommendations.
 * This does not publish a catalog or claim that inference access has been verified.
 */
export async function discoverAccountAntigravityModels(
  apiKey: string,
  signal: AbortSignal,
  fetchCatalog = fetchAvailableModelsCatalog,
): Promise<DiscoveredModel[]> {
  signal.throwIfAborted();
  const { token, projectId } = parseApiKey(apiKey);
  const available = await fetchCatalog(token, projectId, signal);
  signal.throwIfAborted();
  const raw = available.data.models;
  if (!raw) throw new Error("Antigravity model availability could not be confirmed.");
  // Public IDs group effort variants. Keep the exact request ID for manual use,
  // and expose the family ID only to hide variants already present in the picker.
  const catalog = accountAntigravityCatalog(raw);
  const families = new Map<string, string>();
  for (const [publicId, route] of Object.entries(catalog.routing)) {
    for (const runtimeId of [
      route.off,
      route.defaultRequestId,
      ...Object.values(route.routing ?? {}),
    ])
      if (runtimeId) families.set(runtimeId, publicId);
  }
  const models: DiscoveredModel[] = [];
  for (const [id, info] of Object.entries(raw)) {
    if (!isSelectableRuntimeModelId(id, info)) continue;
    const name = [info.displayName, info.label, info.modelName].find(
      value => typeof value === "string" && value.trim(),
    );
    const parsed = DiscoveredModelSchema.safeParse({
      id,
      label: typeof name === "string" ? name.trim().slice(0, 240) : id,
      // A group may contain extra aliases that are never selected by routing.
      // Resolve those in isolation rather than guessing a suffix ourselves.
      catalogId: families.get(id) ?? accountAntigravityCatalog({ [id]: info }).models[0]?.id,
    });
    if (parsed.success) models.push(parsed.data);
  }
  return models
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, 500);
}

export async function refreshAccountAntigravityModels(
  context: RefreshModelsContext,
  fetchCatalog = fetchAvailableModelsCatalog,
) {
  const checkedAt = hydrateAntigravityCatalog(context.stored);
  // The upstream hydrator rejects empty catalogs; a confirmed empty account
  // catalog must also stay empty after Host restart.
  const stored = context.stored as (ModelsStoreEntry & Record<string, unknown>) | undefined;
  const saved = stored?.[ANTIGRAVITY_PERSIST_KEY] as
    | {
        catalog?: { models?: unknown[]; routing?: Record<string, unknown> };
        checkedAt?: number;
      }
    | undefined;
  if (
    saved?.catalog?.models?.length === 0 &&
    saved.catalog.routing &&
    Object.keys(saved.catalog.routing).length === 0 &&
    typeof saved.checkedAt === "number"
  )
    applyAntigravityCatalog({ models: [], routing: {} });
  const current = getCurrentAntigravityCatalog();
  if (!context.allowNetwork) return current.models;
  context.signal.throwIfAborted();
  const credential = context.credential;
  const apiKey =
    credential?.type === "api_key"
      ? credential.key
      : credential?.type === "oauth"
        ? getApiKey(credential)
        : undefined;
  if (!apiKey) throw new Error("Connect this AI provider in settings before generating.");
  if (
    !context.force &&
    checkedAt > 0 &&
    Date.now() >= checkedAt &&
    Date.now() - checkedAt < getCatalogRefreshIntervalMs()
  )
    return current.models;
  const { token, projectId } = parseApiKey(apiKey);
  const available = await fetchCatalog(token, projectId, context.signal);
  context.signal.throwIfAborted();
  if (!available.data.models)
    throw new Error("Antigravity model availability could not be confirmed.");
  const next = accountAntigravityCatalog(
    available.data.models,
    current,
    available.data.agentModelSorts,
  );
  const persist = {
    models: next.models.map(model => ({
      ...model,
      api: ANTIGRAVITY_API,
      provider: "antigravity",
      baseUrl: DEFAULT_ENDPOINT,
    })),
    [ANTIGRAVITY_PERSIST_KEY]: {
      catalog: next,
      checkedAt: Date.now(),
      modelEnums: snapshotDynamicModelEnums(),
    },
  } satisfies ModelsStoreEntry & Record<typeof ANTIGRAVITY_PERSIST_KEY, unknown>;
  const published = await context.publish({
    persist,
    update: () => applyAntigravityCatalog(next),
  });
  return published ? next.models : getCurrentAntigravityCatalog().models;
}
