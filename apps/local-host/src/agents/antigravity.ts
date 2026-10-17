import { join } from "node:path";
import type { ModelRuntime, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
  loginAntigravity,
  refreshAntigravityToken,
  getApiKey,
} from "pi-antigravity/src/auth/oauth.js";
import { withAntigravityAccountDirectory } from "pi-antigravity/src/auth/accounts.js";
import { DEFAULT_ENDPOINT } from "pi-antigravity/src/client/client.js";
import { getCurrentAntigravityCatalog } from "pi-antigravity/src/models/index.js";
import { refreshAccountAntigravityModels } from "./antigravity-catalog";
import { ANTIGRAVITY_API, streamAntigravity } from "pi-antigravity/src/stream/index.js";

/** Fail early if an upstream release changes the catalog contract. */
export function antigravityChatModels(models: ProviderModelConfig[]): ProviderModelConfig[] {
  return models
    .filter(model => model.type === undefined || model.type === "chat")
    .map(model => {
      if (
        (model.type !== undefined && model.type !== "chat") ||
        !model.id?.trim() ||
        !model.name?.trim() ||
        !model.input?.includes("text") ||
        typeof model.reasoning !== "boolean" ||
        !Number.isFinite(model.contextWindow) ||
        model.contextWindow <= 0 ||
        !Number.isFinite(model.maxTokens) ||
        model.maxTokens <= 0 ||
        !model.cost ||
        ![model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite].every(
          value => Number.isFinite(value) && value >= 0,
        )
      ) {
        throw new Error(
          "Incompatible Antigravity chat model definition. Check the pinned package and compatibility patch.",
        );
      }
      return model;
    });
}
/** Register only the provider, never the package's commands, tools or account manager. */
export function registerAntigravity(runtime: ModelRuntime, root: string): void {
  const accountDirectory = join(root, "antigravity");
  runtime.registerProvider("antigravity", {
    name: "Antigravity",
    baseUrl: DEFAULT_ENDPOINT,
    api: ANTIGRAVITY_API,
    models: antigravityChatModels(getCurrentAntigravityCatalog().models),
    refreshModels: async context =>
      antigravityChatModels(await refreshAccountAntigravityModels(context)),
    oauth: {
      name: "Google Antigravity",
      login: loginAntigravity,
      refreshToken: refreshAntigravityToken,
      getApiKey,
    },
    streamSimple: (model, context, options) =>
      withAntigravityAccountDirectory(accountDirectory, () =>
        streamAntigravity(model, context, options),
      ),
  });
}
