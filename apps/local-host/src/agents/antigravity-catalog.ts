import type { RefreshModelsContext, ModelsStoreEntry } from "@earendil-works/pi-ai";
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
  snapshotDynamicModelEnums,
} from "pi-antigravity/src/models/index.js";
import { ANTIGRAVITY_API } from "pi-antigravity/src/stream/index.js";

/** A successful account catalog must not regain models or effort levels from static fallbacks. */
export const accountAntigravityCatalog = (
  raw: Parameters<typeof buildAntigravityCatalog>[0],
  current = getCurrentAntigravityCatalog(),
) => {
  const advertised = buildAntigravityCatalog(raw, { models: [], routing: {} });
  const ids = new Set(advertised.models.map(model => model.id));
  const catalog = buildAntigravityCatalog(raw, { models: current.models, routing: {} });
  return {
    models: catalog.models.filter(model => ids.has(model.id)),
    routing: Object.fromEntries(Object.entries(catalog.routing).filter(([id]) => ids.has(id))),
  };
};

export async function refreshAccountAntigravityModels(
  context: RefreshModelsContext,
  fetchCatalog = fetchAvailableModelsCatalog,
) {
  const checkedAt = hydrateAntigravityCatalog(context.stored);
  // The upstream hydrator rejects empty catalogs; a confirmed empty account
  // catalog must also stay empty after Host restart.
  const stored = context.stored as (ModelsStoreEntry & Record<string, unknown>) | undefined;
  const saved = stored?.[ANTIGRAVITY_PERSIST_KEY] as
    | { catalog?: { models?: unknown[]; routing?: Record<string, unknown> }; checkedAt?: number }
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
  const next = accountAntigravityCatalog(available.data.models, current);
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
