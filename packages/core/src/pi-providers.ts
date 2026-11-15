/** The product's supported providers and their integration policies. */
export const PI_PROVIDER_REGISTRY = [
  { id: "local", adapter: "local", modelCatalog: "static" },
  { id: "openai", adapter: "builtin", modelCatalog: "static" },
  { id: "anthropic", adapter: "builtin", modelCatalog: "static" },
  { id: "google", adapter: "builtin", modelCatalog: "static" },
  { id: "github-copilot", adapter: "builtin", modelCatalog: "static" },
  { id: "openrouter", adapter: "builtin", modelCatalog: "static" },
  { id: "antigravity", adapter: "antigravity", modelCatalog: "dynamic" },
  { id: "amazon-bedrock", adapter: "builtin", modelCatalog: "static" },
  { id: "ant-ling", adapter: "builtin", modelCatalog: "static" },
  { id: "azure", adapter: "builtin", modelCatalog: "static" },
  { id: "baseten", adapter: "builtin", modelCatalog: "static" },
  { id: "cerebras", adapter: "builtin", modelCatalog: "static" },
  { id: "cloudflare-ai-gateway", adapter: "builtin", modelCatalog: "static" },
  { id: "cloudflare-workers-ai", adapter: "builtin", modelCatalog: "static" },
  { id: "deepseek", adapter: "builtin", modelCatalog: "static" },
  { id: "fireworks", adapter: "builtin", modelCatalog: "static" },
  { id: "google-vertex", adapter: "builtin", modelCatalog: "static" },
  { id: "groq", adapter: "builtin", modelCatalog: "static" },
  { id: "huggingface", adapter: "builtin", modelCatalog: "static" },
  { id: "kimi-coding", adapter: "builtin", modelCatalog: "static" },
  { id: "meta", adapter: "builtin", modelCatalog: "static" },
  { id: "minimax", adapter: "builtin", modelCatalog: "static" },
  { id: "minimax-cn", adapter: "builtin", modelCatalog: "static" },
  { id: "mistral", adapter: "builtin", modelCatalog: "static" },
  { id: "moonshotai", adapter: "builtin", modelCatalog: "static" },
  { id: "moonshotai-cn", adapter: "builtin", modelCatalog: "static" },
  { id: "nvidia", adapter: "builtin", modelCatalog: "static" },
  { id: "openai-codex", adapter: "builtin", modelCatalog: "static" },
  { id: "opencode", adapter: "builtin", modelCatalog: "static" },
  { id: "opencode-go", adapter: "builtin", modelCatalog: "static" },
  { id: "qwen-token-plan", adapter: "builtin", modelCatalog: "static" },
  { id: "qwen-token-plan-cn", adapter: "builtin", modelCatalog: "static" },
  { id: "qwen-token-plan-individual", adapter: "builtin", modelCatalog: "static" },
  { id: "qwen-token-plan-individual-cn", adapter: "builtin", modelCatalog: "static" },
  { id: "radius", adapter: "builtin", modelCatalog: "dynamic" },
  { id: "together", adapter: "builtin", modelCatalog: "static" },
  { id: "typesafe", adapter: "builtin", modelCatalog: "static" },
  { id: "vercel-ai-gateway", adapter: "builtin", modelCatalog: "static" },
  { id: "xai", adapter: "builtin", modelCatalog: "static" },
  { id: "xiaomi", adapter: "builtin", modelCatalog: "static" },
  { id: "xiaomi-token-plan-ams", adapter: "builtin", modelCatalog: "static" },
  { id: "xiaomi-token-plan-cn", adapter: "builtin", modelCatalog: "static" },
  { id: "xiaomi-token-plan-sgp", adapter: "builtin", modelCatalog: "static" },
  { id: "zai", adapter: "builtin", modelCatalog: "static" },
  { id: "zai-coding-cn", adapter: "builtin", modelCatalog: "static" },
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
  /** Method of the saved credential, omitted by older Native Hosts. */
  credentialMethod?: "api_key" | "oauth";
  methods: ("api_key" | "oauth")[];
  /** SDK-provided authentication names; optional for older Native Hosts. */
  methodLabels?: Partial<Record<"api_key" | "oauth", string>>;
}
