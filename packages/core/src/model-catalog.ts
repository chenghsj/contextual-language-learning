import type { PiProviderId } from "./pi-providers";

/** IDs are scoped to a service and plan. Public API catalogs must not cross authentication routes. */
export const MODEL_CATALOG_SOURCES = {
  local: {
    directoryId: null,
    lookupUrl: "https://lmstudio.ai/docs/developer/openai-compat/models",
  },
  openai: { directoryId: "openai", lookupUrl: "https://developers.openai.com/api/docs/models/all" },
  anthropic: {
    directoryId: "anthropic",
    lookupUrl: "https://platform.claude.com/docs/en/models/overview",
  },
  google: { directoryId: "google", lookupUrl: "https://aistudio.google.com/docs/models" },
  "github-copilot": {
    directoryId: "github-copilot",
    lookupUrl: "https://models.dev/providers/github-copilot/",
  },
  openrouter: { directoryId: "openrouter", lookupUrl: "https://openrouter.ai/models" },
  antigravity: {
    directoryId: null,
    lookupUrl: "https://github.com/Rahularya01/pi-antigravity#models-and-routing",
  },
  "amazon-bedrock": {
    directoryId: "amazon-bedrock",
    lookupUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html",
  },
  "ant-ling": { directoryId: "bailing", lookupUrl: "https://developer.ant-ling.com/zh-CN/docs" },
  azure: {
    directoryId: null,
    lookupUrl: "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/create-resource",
  },
  baseten: {
    directoryId: "baseten",
    lookupUrl: "https://docs.baseten.co/inference/model-apis/overview",
  },
  cerebras: {
    directoryId: "cerebras",
    lookupUrl: "https://inference-docs.cerebras.ai/models/overview",
  },
  "cloudflare-ai-gateway": {
    directoryId: null,
    lookupUrl: "https://developers.cloudflare.com/ai-gateway/usage/",
  },
  "cloudflare-workers-ai": {
    directoryId: "cloudflare-workers-ai",
    lookupUrl: "https://developers.cloudflare.com/workers-ai/models/",
  },
  deepseek: {
    directoryId: "deepseek",
    lookupUrl: "https://api-docs.deepseek.com/quick_start/pricing",
  },
  fireworks: { directoryId: "fireworks-ai", lookupUrl: "https://fireworks.ai/docs/" },
  "google-vertex": {
    directoryId: "google-vertex",
    lookupUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/models",
  },
  groq: { directoryId: "groq", lookupUrl: "https://console.groq.com/docs/models" },
  huggingface: {
    directoryId: "huggingface",
    lookupUrl: "https://huggingface.co/docs/inference-providers",
  },
  "kimi-coding": {
    directoryId: "kimi-code-plan-cn",
    lookupUrl: "https://www.kimi.com/code/docs/en/kimi-code/models.html",
  },
  meta: { directoryId: "meta", lookupUrl: "https://dev.meta.ai/docs" },
  minimax: {
    directoryId: "minimax",
    lookupUrl: "https://platform.minimax.io/docs/guides/models-intro",
  },
  "minimax-cn": {
    directoryId: "minimax-cn",
    lookupUrl: "https://platform.minimaxi.com/docs/guides/models-intro",
  },
  mistral: { directoryId: "mistral", lookupUrl: "https://docs.mistral.ai/models" },
  moonshotai: { directoryId: "moonshotai", lookupUrl: "https://platform.kimi.ai/docs/models" },
  "moonshotai-cn": {
    directoryId: "moonshotai-cn",
    lookupUrl: "https://platform.moonshot.cn/docs/api/chat",
  },
  nvidia: { directoryId: "nvidia", lookupUrl: "https://docs.api.nvidia.com/nim/" },
  "openai-codex": { directoryId: null, lookupUrl: "https://developers.openai.com/codex/models" },
  opencode: { directoryId: "opencode", lookupUrl: "https://opencode.ai/v2/docs/console/models/" },
  "opencode-go": {
    directoryId: "opencode-go",
    lookupUrl: "https://opencode.ai/v2/docs/console/go/",
  },
  "qwen-token-plan": {
    directoryId: "alibaba-token-plan",
    lookupUrl: "https://www.alibabacloud.com/help/en/model-studio/token-plan-overview",
  },
  "qwen-token-plan-cn": {
    directoryId: "alibaba-token-plan-cn",
    lookupUrl: "https://www.alibabacloud.com/help/zh/model-studio/token-plan-overview",
  },
  "qwen-token-plan-individual": {
    directoryId: "alibaba-coding-plan",
    lookupUrl: "https://www.alibabacloud.com/help/en/model-studio/coding-plan",
  },
  "qwen-token-plan-individual-cn": {
    directoryId: "alibaba-coding-plan-cn",
    lookupUrl: "https://help.aliyun.com/zh/model-studio/coding-plan",
  },
  radius: {
    directoryId: null,
    lookupUrl: "https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/radius.ts",
  },
  together: {
    directoryId: "togetherai",
    lookupUrl: "https://docs.together.ai/docs/serverless-models",
  },
  typesafe: {
    directoryId: null,
    lookupUrl:
      "https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/typesafe.ts",
  },
  "vercel-ai-gateway": { directoryId: "vercel", lookupUrl: "https://vercel.com/ai-gateway/models" },
  xai: { directoryId: "xai", lookupUrl: "https://docs.x.ai/docs/models" },
  xiaomi: { directoryId: "xiaomi", lookupUrl: "https://platform.xiaomimimo.com/#/docs" },
  "xiaomi-token-plan-ams": {
    directoryId: "xiaomi-token-plan-ams",
    lookupUrl: "https://platform.xiaomimimo.com/#/docs",
  },
  "xiaomi-token-plan-cn": {
    directoryId: "xiaomi-token-plan-cn",
    lookupUrl: "https://platform.xiaomimimo.com/#/docs",
  },
  "xiaomi-token-plan-sgp": {
    directoryId: "xiaomi-token-plan-sgp",
    lookupUrl: "https://platform.xiaomimimo.com/#/docs",
  },
  zai: { directoryId: "zai", lookupUrl: "https://docs.z.ai/api-reference/llm/chat-completion" },
  "zai-coding-cn": {
    directoryId: "zhipuai-coding-plan",
    lookupUrl: "https://docs.bigmodel.cn/cn/coding-plan/overview",
  },
} satisfies Record<PiProviderId, { directoryId: string | null; lookupUrl: string }>;

export function modelCatalogSource(provider: string) {
  return Object.hasOwn(MODEL_CATALOG_SOURCES, provider)
    ? MODEL_CATALOG_SOURCES[provider as PiProviderId]
    : undefined;
}

export function modelCatalogLookupUrl(provider: string, method?: "api_key" | "oauth") {
  return modelCatalogSource(provider === "openai" && method === "oauth" ? "openai-codex" : provider)
    ?.lookupUrl;
}
