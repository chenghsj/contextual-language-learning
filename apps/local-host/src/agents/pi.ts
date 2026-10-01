import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import {
  PI_PROVIDER_IDS,
  piProviderDefinition,
  isPiProviderId,
  type AgentSettings,
  type PiProviderInfo,
} from "@immersive/core";
import { appConfigRoot } from "../platform/paths";
import { configurePiProviders } from "./provider-registry";
import { parseAgentJson } from "./json";

export const piRoot = () => join(appConfigRoot(), "pi");
export async function createPiRuntime(root = piRoot()): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(root, "models-cache.json"),
    refreshOnCreate: false,
  });
  configurePiProviders(runtime, root);
  await runtime.refresh({ allowNetwork: false });
  return runtime;
}
export function assertPiProvider(provider: string): void {
  if (!isPiProviderId(provider))
    throw new Error(
      "This task uses an old CLI Agent. Create a new lesson with a connected Pi provider; saved lessons are preserved.",
    );
}
/** Completely bypass global and project resource discovery. */
export function lessonResources(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      "Generate language learning material from the supplied subtitles. Follow the stage instructions and return only the requested JSON object. Never invent source references.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
export async function piProviders(inputRuntime?: ModelRuntime): Promise<PiProviderInfo[]> {
  const runtime = inputRuntime ?? (await createPiRuntime());
  const credentials = await runtime.listCredentials();
  return PI_PROVIDER_IDS.flatMap(id => {
    const provider = runtime.getProvider(id);
    if (!provider) return [];
    return [
      {
        id,
        label: provider.name,
        connected: credentials.some(c => c.providerId === id),
        methods: [
          ...(provider.auth.oauth ? ["oauth" as const] : []),
          ...(provider.auth.apiKey?.login ? ["api_key" as const] : []),
        ],
      },
    ];
  });
}
/** Stable product-owned installation ID required by the SDK's ChatGPT OAuth flow. */
export async function piDeviceId(root = piRoot()): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "device-id");
  try {
    await writeFile(path, randomUUID(), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const id = (await readFile(path, "utf8")).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(
      "Invalid local AI installation ID. Restore the product's device-id file before reconnecting.",
    );
  }
  return id;
}
export async function loginPi(
  provider: string,
  method: "api_key" | "oauth",
  interaction: AuthInteraction,
): Promise<void> {
  assertPiProvider(provider);
  await mkdir(piRoot(), { recursive: true, mode: 0o700 });
  const runtime = await createPiRuntime();
  const deviceId = method === "oauth" ? await piDeviceId() : undefined;
  await runtime.login(provider, method, interaction, { getDeviceId: () => deviceId ?? "" });
}
export async function logoutPi(provider: string): Promise<void> {
  assertPiProvider(provider);
  await (await createPiRuntime()).logout(provider);
}
export async function piModels(settings: AgentSettings, inputRuntime?: ModelRuntime) {
  assertPiProvider(settings.provider);
  const runtime = inputRuntime ?? (await createPiRuntime());
  if (piProviderDefinition(settings.provider)?.modelCatalog === "dynamic") {
    const result = await runtime.refresh({
      providers: [settings.provider],
      force: true,
      allowNetwork: true,
    });
    const error = result.errors.get(settings.provider);
    if (error) throw error;
  }
  const models = await runtime.getAvailable(settings.provider);
  return {
    models: models.map(model => ({
      id: model.id,
      label: model.name,
      thinkingLevels: getSupportedThinkingLevels(model),
    })),
    source: "sdk" as const,
  };
}
export async function generatePi(
  settings: AgentSettings,
  prompt: string,
  signal: AbortSignal,
  options: { runtime?: ModelRuntime; root?: string } = {},
): Promise<unknown> {
  assertPiProvider(settings.provider);
  signal.throwIfAborted();
  const runtime = options.runtime ?? (await createPiRuntime());
  if (!(await runtime.listCredentials()).some(c => c.providerId === settings.provider)) {
    throw new Error("Connect this AI provider in settings before generating.");
  }
  const model = settings.modelId
    ? runtime.getModel(settings.provider, settings.modelId)
    : (await runtime.getAvailable(settings.provider, { signal }))[0];
  if (!model)
    throw new Error("The selected model is unavailable. Refresh the provider and choose a model.");
  const root = options.root ?? piRoot();
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: root,
    modelRuntime: runtime,
    model,
    thinkingLevel: settings.thinkingLevel,
    tools: [],
    noTools: "all",
    resourceLoader: lessonResources(),
    sessionManager: SessionManager.inMemory(root),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });
  const abort = () => {
    void session.abort().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (session.getActiveToolNames().length)
      throw new Error("Lesson generation must not expose tools.");
    signal.throwIfAborted();
    await session.prompt(prompt);
    signal.throwIfAborted();
    const last = session.messages.at(-1);
    if (!last || last.role !== "assistant" || last.stopReason !== "stop") {
      throw new Error(
        "AI generation did not finish successfully. Reconnect if authorization expired, then retry this stage.",
      );
    }
    const text = session.getLastAssistantText();
    if (!text || text.length > 2_000_000)
      throw new Error("AI returned empty or oversized lesson output.");
    return parseAgentJson(text, "Pi");
  } finally {
    signal.removeEventListener("abort", abort);
    session.dispose();
  }
}
