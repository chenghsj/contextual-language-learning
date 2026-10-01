/** The product's supported providers and their integration policies. */
export const PI_PROVIDER_REGISTRY = [
  { id: "openai", adapter: "builtin", modelCatalog: "static" },
  { id: "anthropic", adapter: "builtin", modelCatalog: "static" },
  { id: "google", adapter: "builtin", modelCatalog: "static" },
  { id: "github-copilot", adapter: "builtin", modelCatalog: "static" },
  { id: "openrouter", adapter: "builtin", modelCatalog: "static" },
  { id: "antigravity", adapter: "antigravity", modelCatalog: "dynamic" },
] as const;
export type PiProviderId = (typeof PI_PROVIDER_REGISTRY)[number]["id"];
export type PiProviderAdapter = (typeof PI_PROVIDER_REGISTRY)[number]["adapter"];
export const PI_PROVIDER_IDS = PI_PROVIDER_REGISTRY.map(provider => provider.id);
export function piProviderDefinition(id: string) {
  return PI_PROVIDER_REGISTRY.find(provider => provider.id === id);
}
export function isPiProviderId(value: unknown): value is PiProviderId {
  return typeof value === "string" && piProviderDefinition(value) !== undefined;
}
export interface PiProviderInfo {
  id: string;
  label: string;
  connected: boolean;
  methods: ("api_key" | "oauth")[];
}
