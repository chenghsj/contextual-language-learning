import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  LocalModelConfigSchema,
  LocalModelInputSchema,
  type LocalModelConfig,
  type LocalModelInput,
} from "@contextual/core";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const configPath = (root: string) => join(root, "local-model.json");
const mutations = new Map<string, Promise<unknown>>();
function serialize<T>(root: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(root);
  const pending = (mutations.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  mutations.set(key, pending);
  void pending
    .finally(() => {
      if (mutations.get(key) === pending) mutations.delete(key);
    })
    .catch(() => {});
  return pending;
}
export async function readLocalModelConfig(root: string): Promise<LocalModelConfig | null> {
  try {
    return LocalModelConfigSchema.parse(JSON.parse(await readFile(configPath(root), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Local model settings are invalid. Save the connection settings again.");
  }
}
export function localModelSnapshot(root: string, credentials: CredentialStore) {
  return serialize(root, async () => {
    const config = await readLocalModelConfig(root);
    const credential = config ? await credentials.read("local") : undefined;
    return { config, apiKey: credential?.type === "api_key" ? (credential.key ?? "") : "" };
  });
}
export async function localModelState(root: string, credentials: CredentialStore) {
  const snapshot = await localModelSnapshot(root, credentials);
  return { config: snapshot.config, hasApiKey: !!snapshot.apiKey };
}
async function keyFor(input: LocalModelInput, root: string, credentials: CredentialStore) {
  if (input.apiKey !== undefined) return input.apiKey;
  const previous = await readLocalModelConfig(root).catch(() => null);
  if (previous?.baseUrl !== input.config.baseUrl) return "";
  const credential = await credentials.read("local");
  return credential?.type === "api_key" ? (credential.key ?? "") : "";
}
export function saveLocalModelConfig(
  input: LocalModelInput,
  root: string,
  credentials: CredentialStore,
) {
  const parsed = LocalModelInputSchema.parse(input);
  return serialize(root, async () => {
    const apiKey = await keyFor(parsed, root, credentials);
    const previousCredential = await credentials.read("local");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = configPath(root) + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify(parsed.config), { mode: 0o600, flag: "wx" });
      if (apiKey) await credentials.modify("local", async () => ({ type: "api_key", key: apiKey }));
      else await credentials.delete("local");
      try {
        await rename(temporary, configPath(root));
      } catch (error) {
        if (previousCredential) await credentials.modify("local", async () => previousCredential);
        else await credentials.delete("local");
        throw error;
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return { config: parsed.config, hasApiKey: !!apiKey };
  });
}
export function removeLocalModelConfig(root: string, credentials: CredentialStore) {
  return serialize(root, async () => {
    await credentials.delete("local");
    await unlink(configPath(root)).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
  });
}
/** No actual key enters the SDK's command/interpolation-based provider configuration. */
export function registerLocalModel(runtime: ModelRuntime, config: LocalModelConfig | null = null) {
  runtime.registerProvider("local", {
    name: "Local / custom",
    baseUrl: config?.baseUrl ?? "http://127.0.0.1:11434/v1",
    api: "openai-completions",
    apiKey: "local",
    models: config
      ? [
          {
            id: config.modelId,
            name: config.modelId,
            input: ["text"],
            reasoning: config.reasoning,
            contextWindow: config.contextWindow,
            maxTokens: config.maxTokens,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            compat: {
              supportsDeveloperRole: false,
              supportsReasoningEffort: config.reasoning,
              supportsStore: false,
              maxTokensField: "max_tokens",
            },
          },
        ]
      : [],
  });
}
export async function testLocalModelConfig(
  input: LocalModelInput,
  root: string,
  credentials: CredentialStore,
  fetcher = fetch,
) {
  const parsed = LocalModelInputSchema.parse(input);
  const apiKey = await serialize(root, () => keyFor(parsed, root, credentials));
  let response: Response;
  try {
    response = await fetcher(parsed.config.baseUrl + "/models", {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
  } catch {
    throw new Error(
      "Local model connection failed. Check the server address and make sure the server is running.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Local model server returned HTTP ${response.status}. Check the address and API key.`,
    );
  try {
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    if (!Array.isArray(body.data)) throw new Error();
    return {
      modelIds: [
        ...new Set(
          body.data.flatMap(item =>
            typeof item?.id === "string" && item.id.length > 0 && item.id.length <= 120
              ? [item.id]
              : [],
          ),
        ),
      ].slice(0, 500),
    };
  } catch {
    throw new Error(
      "Local model server did not return an OpenAI-compatible model list. Check that the address ends with /v1.",
    );
  }
}
