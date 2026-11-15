import { DiscoveredModelSchema, modelCatalogSource, type DiscoveredModel } from "@contextual/core";

const CATALOG_URL = "https://models.dev/api.json";
const MAX_BYTES = 16 * 1024 * 1024;
const CACHE_MS = 60 * 60_000;
type Catalog = Record<string, unknown>;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** This catalog supplies names and opaque service IDs, never credentials or inference capabilities. */
export function createPublicModelCatalog(fetcher: typeof fetch = (...args) => fetch(...args)) {
  let cached: { data: Catalog; at: number } | undefined;
  let pending: Promise<Catalog> | undefined;
  async function download(): Promise<Catalog> {
    const response = await fetcher(CATALOG_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body) throw new Error("The model directory is unavailable.");
    const reader = response.body.getReader();
    let size = 0;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("The model directory is too large.");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const data: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!record(data)) throw new Error("The model directory returned invalid data.");
    cached = { data, at: Date.now() };
    return data;
  }
  return async (provider: string, force = false): Promise<DiscoveredModel[]> => {
    const directoryId = modelCatalogSource(provider)?.directoryId;
    if (!directoryId) return [];
    let data: Catalog;
    if (!force && cached && Date.now() - cached.at < CACHE_MS) data = cached.data;
    else {
      pending ??= download().finally(() => {
        pending = undefined;
      });
      data = await pending;
    }
    const directory = data[directoryId];
    if (!record(directory) || !record(directory.models)) return [];
    const models: DiscoveredModel[] = [];
    for (const [id, entry] of Object.entries(directory.models)) {
      if (!record(entry) || (entry.id !== undefined && entry.id !== id)) continue;
      if (entry.status === "deprecated" || entry.disabled === true) continue;
      // Match Pi's chat catalog policy. Embeddings and realtime/audio endpoints
      // can advertise text modalities too, but cannot use the text chat transport.
      if (entry.tool_call !== true) continue;
      if (
        !record(entry.modalities) ||
        !Array.isArray(entry.modalities.input) ||
        !Array.isArray(entry.modalities.output) ||
        !entry.modalities.input.includes("text") ||
        entry.modalities.output.length !== 1 ||
        entry.modalities.output[0] !== "text"
      )
        continue;
      const parsed = DiscoveredModelSchema.safeParse({ id, label: entry.name ?? id });
      if (parsed.success) models.push(parsed.data);
    }
    return models
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      .slice(0, 500);
  };
}

export const publicModelCatalog = createPublicModelCatalog();
