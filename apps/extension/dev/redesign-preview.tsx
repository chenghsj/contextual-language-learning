import { notifyAnalysisComplete } from "../src/native/analysis-notifications";
// Development-only acceptance fixture: actual App/worker, simulated browser and Host.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { installGenerationController } from "../src/native/generation-controller";
import { defaultPreferences } from "../src/lib/preferences-store";
import { document as lesson } from "./reader-fixture";
import {
  HOST_PROTOCOL_VERSION,
  captureFavorite,
  captureCustomFavorite,
  favoriteText,
  type FavoriteCollection,
  type FavoriteSnapshot,
  type FavoriteSummary,
  validateLearningDocumentV7,
  type HostRequest,
  type HostMessage,
  type CustomDocument,
  type JobSummary,
  type PiProviderInfo,
  type AgentModel,
  type DiscoveredModel,
  type GenerationRequest,
  type LearningDocument,
} from "@contextual/core";
import "../src/styles.css";

function event<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    addListener: (fn: (value: T) => void) => listeners.add(fn),
    removeListener: (fn: (value: T) => void) => listeners.delete(fn),
    fire: (value: T) => listeners.forEach(fn => fn(value)),
  };
}
function portPair(name: string) {
  const a = {
    name,
    sender: { id: "preview", url: "chrome-extension://preview/sidepanel.html" },
    onMessage: event<unknown>(),
    onDisconnect: event<void>(),
    postMessage: (value: unknown) => queueMicrotask(() => b.onMessage.fire(value)),
    disconnect: () => {
      a.onDisconnect.fire();
      b.onDisconnect.fire();
    },
  };
  const b = {
    ...a,
    onMessage: event<unknown>(),
    onDisconnect: event<void>(),
    postMessage: (value: unknown) => queueMicrotask(() => a.onMessage.fire(value)),
  };
  return [a, b] as const;
}
const storagePreview = new URLSearchParams(location.search).get("storage") === "1";
const previewLocale = new URLSearchParams(location.search).get("locale") === "ja" ? "ja" : "zh-TW";
const preferences = {
  ...defaultPreferences("zh-TW"),
  uiLocalePreference: previewLocale,
  themePreference: new URLSearchParams(location.search).get("theme") ?? "light",
  motionPreference: new URLSearchParams(location.search).get("motion") ?? "full",
  agent: { provider: "openai", modelId: "fixture-model" },
  providerSettings: { openai: { provider: "openai", modelId: "fixture-model" } },
  ...(new URLSearchParams(location.search).has("favoriteBackupAccount")
    ? {
        backup: {
          enabled: false,
          accountId:
            new URLSearchParams(location.search).get("favoriteBackupAccount") ?? "drive-preview",
        },
      }
    : {}),
  ...(new URLSearchParams(location.search).get("storagePath") === "long"
    ? {
        destination: {
          kind: "local",
          directory:
            "/Users/preview/Documents/語言學習與教材備份/Contextual Language Learning/完整影片教材與個人學習記錄",
        },
      }
    : {}),
};
const persistentMotionPreview =
  new URLSearchParams(location.search).has("motionAcceptance") ||
  new URLSearchParams(location.search).has("customModels");
const motionPreviewKey = "motion-acceptance-preferences";
const motionPreviewSaved = persistentMotionPreview
  ? sessionStorage.getItem(motionPreviewKey)
  : null;
const saved: Record<string, unknown> = {
  preferencesV2: motionPreviewSaved ? JSON.parse(motionPreviewSaved) : preferences,
};
const motionLesson = () => {
  const scene = lesson.sections[0],
    first = scene.cueIds[0];
  const firstCue = lesson.cues.find(cue => cue.id === first)!;
  const nextCue = lesson.cues.find(cue => cue.id === scene.cueIds[1])!;
  return validateLearningDocumentV7({
    ...lesson,
    sections: [
      {
        ...scene,
        id: "00000000-0000-4000-8000-000000000099",
        title: "Dinner question",
        cueIds: [first],
        startMs: firstCue.startMs,
        endMs: firstCue.endMs,
        context: { text: "A question about dinner.", evidenceCueIds: [first] },
        contextCueIds: [],
        utterances: scene.utterances.filter(u => u.cueIds.includes(first)),
        translations: scene.translations.filter(t => t.cueId === first),
      },
      {
        ...scene,
        cueIds: scene.cueIds.slice(1),
        startMs: nextCue.startMs,
        contextCueIds: [first],
        utterances: scene.utterances.filter(u => !u.cueIds.includes(first)),
        translations: scene.translations.filter(t => t.cueId !== first),
      },
    ],
  });
};
const docs = new Map<string, CustomDocument>();
const jobs = new Map<string, JobSummary>();
const generatedLessons = new Map<string, LearningDocument>();
const compactPreview = new URLSearchParams(location.search).has("compactPreview");
const compactFull = compactPreview ? motionLesson() : null;
if (compactFull) {
  jobs.set(compactFull.id, {
    id: compactFull.id,
    sourceTitle: compactFull.source.title,
    provider: "anthropic",
    status: "running",
    phase: "creating",
    completed: 3,
    total: 5,
    createdAt: compactFull.createdAt,
    updatedAt: new Date().toISOString(),
    previewRevision: 1,
    readySceneIds: [compactFull.sections[1].id],
    selectedSceneCount: 2,
    execution: { ...compactFull.execution!, generationStrategyVersion: "compact-scenes-1" },
  });
  Object.assign(window, {
    advanceCompactPreview: (complete = false) => {
      const job = jobs.get(compactFull.id)!;
      jobs.set(compactFull.id, {
        ...job,
        previewRevision: complete ? 3 : 2,
        readySceneIds: compactFull.sections.map(s => s.id),
        completed: complete ? 5 : 4,
        status: complete ? "completed" : "running",
        documentId: complete ? compactFull.id : undefined,
        updatedAt: new Date().toISOString(),
      });
      if (complete) generatedLessons.set(compactFull.id, compactFull);
    },
  });
}
// Controlled queue for Activity acceptance. It never invokes a provider or writes user data.
const activityQueuePreview = new URLSearchParams(location.search).get("activityQueue") === "1";
const queuedGenerations = new Map<
  string,
  {
    payload: GenerationRequest;
    reply: (message: Record<string, unknown>) => void;
  }
>();
function startNextPreviewJob() {
  if ([...jobs.values()].some(job => job.status === "running")) return;
  const job = [...jobs.values()].find(job => job.status === "queued");
  if (!job) return;
  Object.assign(job, {
    status: "running",
    phase: "creating",
    completed: 2,
    updatedAt: new Date().toISOString(),
  });
  queuedGenerations.get(job.id)?.reply({ type: "job", job: { ...job } });
}
const commands: HostRequest[] = [];
const notifications: { id: string; title: string }[] = [];
const generationPorts = new Set<{ disconnect(): void }>();
const providerPreview = new URLSearchParams(location.search).get("providers") === "1";
let previewLocalConfig: import("@contextual/core").LocalModelConfig | null = null;
let previewLocalHasKey = false;
const previewProviders: PiProviderInfo[] = [
  { id: "local", label: "Local / custom", connected: false, methods: [] },
  {
    id: "openai",
    label: "OpenAI",
    connected: true,
    credentialMethod: "oauth",
    methods: ["api_key", "oauth"],
  },
  { id: "anthropic", label: "Anthropic", connected: false, methods: ["api_key", "oauth"] },
  {
    id: "google",
    label: "Google",
    connected: true,
    credentialMethod: "api_key",
    methods: ["api_key"],
  },
  { id: "github-copilot", label: "GitHub Copilot", connected: false, methods: ["oauth"] },
];
if (new URLSearchParams(location.search).has("customModels"))
  previewProviders.push({
    id: "antigravity",
    label: "Google Antigravity",
    connected: true,
    methods: ["oauth"],
  });
const previewLogins = new Map<
  string,
  {
    provider: string;
    method: NonNullable<PiProviderInfo["credentialMethod"]>;
    reply: (message: Record<string, unknown>) => void;
  }
>();
const favoritesPreview = new URLSearchParams(location.search).has("favorites");
const drivePreview =
  favoritesPreview || storagePreview || new URLSearchParams(location.search).get("drive") === "1";
const previewAccount = { id: "drive-preview", email: "learner@example.test" };
const previewAccounts =
  storagePreview || favoritesPreview
    ? [
        previewAccount,
        { id: "drive-second", email: "language.learning.secondary.account@example.test" },
      ]
    : [previewAccount];
if (storagePreview) {
  const at = "2026-10-08T05:06:49.000Z";
  jobs.set(lesson.id, {
    id: lesson.id,
    sourceTitle: "Backup preview lesson",
    provider: "openai",
    status: "completed",
    completed: 1,
    total: 1,
    createdAt: at,
    updatedAt: at,
    backup: { status: "backed-up", accountId: previewAccount.id, updatedAt: at },
  });
}
const favoriteCollections = new Map<
  string,
  Map<string, { snapshot: FavoriteSnapshot; summary: FavoriteSummary; operationId: string }>
>();
const favoritesEnabled = new Set<string>();
const favoriteImports = new Set<string>();
function favoriteCollectionId(collection: FavoriteCollection) {
  return collection.kind === "local" ? "local" : collection.accountId;
}
function favoriteRecords(collection: FavoriteCollection) {
  const id = favoriteCollectionId(collection);
  let records = favoriteCollections.get(id);
  if (!records) {
    records = new Map();
    favoriteCollections.set(id, records);
  }
  return records;
}
function favoriteStatus(collection: FavoriteCollection) {
  const enabled = collection.kind === "account" && favoritesEnabled.has(collection.accountId);
  return {
    collection,
    enabled,
    state: collection.kind === "local" ? "local" : enabled ? "synced" : "disabled",
    pending: 0,
  };
}
if (favoritesPreview)
  saved["contextualStudyV5:" + lesson.id] = {
    sceneId: motionLesson().sections[1].id,
    visitedSceneIds: [],
  };
const openedUrls: string[] = [];
const acceptance = {
  commands,
  docs,
  jobs,
  notifications,
  hostRegistered: true,
  nativeConnections: 0,
  agentModels: [{ id: "fixture-model", label: "Fixture model" }] as AgentModel[],
  failModelDiscovery: false,
  modelDirectories: {
    openai: [{ id: "gpt-future-search", label: "GPT Future Search" }],
    antigravity: [
      { id: "fixture-model-high", label: "Existing model (High)", catalogId: "fixture-model" },
      {
        id: "gemini-future-discovered-high",
        label: "Gemini Future (High)",
        catalogId: "gemini-future-discovered",
      },
    ],
  } as Record<string, DiscoveredModel[]>,
  failBackup: false,
  failNextFavorite: false,
  failNextFavoriteConfiguration: false,
  favoriteSourceDeleted: false,
  deleteCustomSource: () => docs.clear(),
  favoriteCollections,
  failPreferenceWrites: false,
  preferenceWriteFailures: 0,
  openedUrls,
  holdAdmission: false,
  failNextAdmission: false,
  setVideo: (url: string, title: string) => {
    Object.assign(tab, { url, title });
  },
  admitGeneration: (id: string) => {
    const generation = queuedGenerations.get(id);
    if (!generation) throw new Error("Unknown preview generation");
    const now = new Date().toISOString();
    const job: JobSummary = {
      id,
      sourceTitle: generation.payload.source.title,
      provider: "openai",
      status: "queued",
      completed: 0,
      total: 6,
      createdAt: now,
      updatedAt: now,
    };
    jobs.set(id, job);
    generation.reply({ type: "job", job: { ...job } });
    startNextPreviewJob();
  },
  repeatJob: (id: string) =>
    queuedGenerations.get(id)?.reply({ type: "job", job: { ...jobs.get(id)! } }),
  finishGeneration: (id: string) => {
    const generation = queuedGenerations.get(id),
      job = jobs.get(id);
    if (!generation || !job || job.status !== "running")
      throw new Error("Preview job is not running");
    const doc: LearningDocument = { ...lesson, id, source: generation.payload.source };
    generatedLessons.set(id, doc);
    Object.assign(job, {
      status: "completed",
      phase: "saving",
      completed: 6,
      documentId: id,
      updatedAt: new Date().toISOString(),
    });
    generation.reply({ type: "job", job: { ...job } });
    generation.reply({ type: "result", document: doc });
    generation.reply({ type: "generationSettled" });
    startNextPreviewJob();
  },
  setPiProviders: (providers: PiProviderInfo[]) => {
    previewProviders.splice(0, previewProviders.length, ...providers);
  },
  finishBackups: (() => {}) as () => void,
  finishPiLogin: (providerId: string) => {
    for (const [id, login] of previewLogins) {
      if (login.provider !== providerId) continue;
      Object.assign(
        previewProviders.find(provider => provider.id === providerId)!,
        {
          connected: true,
          credentialMethod: login.method,
        },
      );
      login.reply({ type: "piAuthDone" });
      previewLogins.delete(id);
    }
  },
  disconnectHost: () => {
    for (const port of generationPorts) port.disconnect();
    generationPorts.clear();
  },
};
Object.assign(window, { acceptance });
const tab = {
  id: 1,
  windowId: 1,
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Acceptance video - YouTube",
};
const onConnect = event<unknown>();
const execution = {
  workflowVersion: "custom-workflow-v1",
  promptVersion: "custom-prompt-v1",
  schemaVersion: "custom-v1",
  inputFingerprint: "a".repeat(64),
  provider: "openai",
  modelId: "fixture-model",
  contextWindow: 16384,
  maxOutputTokens: 4096,
  chunkPlan: [],
  calls: [],
};
if (new URLSearchParams(location.search).get("customFavorites") === "1") {
  const id = "00000000-0000-4000-8000-0000000000cf";
  docs.set(id, {
    schemaVersion: "custom-v1",
    kind: "custom",
    id,
    title: "自訂教材收藏測試",
    createdAt: "2026-10-21T00:00:00.000Z",
    request: {
      id,
      kind: "custom",
      source: { platform: "import", title: "Synthetic custom source" },
      agent: { provider: "openai", modelId: "fixture-model" },
      prompt: "Synthetic custom prompt",
      context: { subtitles: true, title: true },
      cues: lesson.cues,
    },
    execution,
    markdown: "# 日本語筆記\n\n**ありがとう**：謝謝。\n\n完整的自訂教材內容。",
  });
}
function nativePort() {
  if (!acceptance.hostRegistered) throw new Error("Specified native messaging host not found.");
  acceptance.nativeConnections++;
  const [worker, host] = portPair("native");
  host.onMessage.addListener(raw => {
    const request = raw as HostRequest;
    commands.push(request);
    const reply = (value: Omit<HostMessage, "id"> | Record<string, unknown>) =>
      host.postMessage({ id: request.id, ...value });
    switch (request.type) {
      case "favoriteStates": {
        const records = favoriteRecords(request.collection);
        reply({
          type: "favoriteStates",
          collection: request.collection,
          states: Object.fromEntries(
            request.sceneIds.map(sceneId => [
              sceneId,
              [...records.values()].some(
                record =>
                  record.summary.documentId === request.documentId &&
                  record.summary.sceneId === sceneId,
              ),
            ]),
          ),
        });
        break;
      }
      case "setFavorite": {
        if (acceptance.failNextFavorite) {
          acceptance.failNextFavorite = false;
          reply({ type: "error", message: "Preview favorite failure" });
          break;
        }
        const input = request.input;
        const records = favoriteRecords(input.collection);
        const doc = favoritesPreview ? motionLesson() : lesson;
        const custom = input.documentId === input.sceneId;
        const scene = custom ? null : doc.sections.find(scene => scene.id === input.sceneId);
        const key = custom
          ? "c".repeat(64)
          : (doc.sections.indexOf(scene!) + 1).toString(16).padStart(64, "0");
        if (input.desired) {
          const customDoc = docs.get(input.documentId);
          const snapshot =
            records.get(key)?.snapshot ??
            (custom && customDoc
              ? captureCustomFavorite(customDoc, "2026-10-21T00:00:00.000Z", "fixture")
              : scene
                ? captureFavorite(doc, scene.id, "2026-10-20T00:00:00.000Z", "fixture")
                : null);
          if (!snapshot) {
            reply({ type: "error", message: "Saved content not found" });
            break;
          }
          const text = favoriteText(snapshot);
          const summary: FavoriteSummary = {
            key,
            documentId: input.documentId,
            sceneId: input.sceneId,
            kind: custom ? "custom" : "scene",
            title: text.title,
            sourceTitle: snapshot.source.title,
            language: text.language,
            excerpt: text.excerpt,
            savedAt: snapshot.origin.capturedAt,
            pending: false,
          };
          records.set(key, { snapshot, summary, operationId: input.mutationId });
        } else records.delete(key);
        reply({
          type: "favoriteChanged",
          collection: input.collection,
          favorite: records.get(key)?.summary ?? null,
        });
        break;
      }
      case "listFavorites": {
        const items = [...favoriteRecords(request.collection).values()]
          .map(record => record.summary)
          .filter(
            item =>
              (!request.query.language || item.language === request.query.language) &&
              (!request.query.search ||
                [item.title, item.sourceTitle, item.excerpt]
                  .join(" ")
                  .toLowerCase()
                  .includes(request.query.search.toLowerCase())),
          );
        const offset = Number(request.query.cursor ?? 0);
        const end = offset + request.query.limit;
        reply({
          type: "favorites",
          collection: request.collection,
          page: {
            items: items.slice(offset, end),
            nextCursor: end < items.length ? String(end) : undefined,
            partial: false,
          },
        });
        break;
      }
      case "getFavorite": {
        const record = favoriteRecords(request.collection).get(request.key);
        if (!record) reply({ type: "error", message: "Favorite not found" });
        else {
          const bytes = new TextEncoder().encode(JSON.stringify(record.snapshot));
          const middle = Math.floor(bytes.length / 2);
          [bytes.slice(0, middle), bytes.slice(middle)].forEach((part, index) =>
            reply({
              type: "favoriteChunk",
              collection: request.collection,
              key: request.key,
              index,
              total: 2,
              dataBase64: btoa(Array.from(part, byte => String.fromCharCode(byte)).join("")),
            }),
          );
        }
        break;
      }
      case "favoriteStatus":
      case "syncFavorites":
        reply({ type: "favoriteStatus", status: favoriteStatus(request.collection) });
        break;
      case "configureFavorites": {
        if (acceptance.failNextFavoriteConfiguration) {
          acceptance.failNextFavoriteConfiguration = false;
          reply({ type: "error", message: "Preview favorite configuration failure" });
          break;
        }
        const collection: FavoriteCollection = {
          kind: "account",
          accountId: request.change.accountId,
        };
        if (request.change.kind === "enable") {
          favoritesEnabled.add(request.change.accountId);
          if (request.change.importLocal)
            for (const [key, record] of favoriteRecords({ kind: "local" })) {
              const imported = request.change.accountId + ":" + record.operationId;
              if (favoriteImports.has(imported)) continue;
              favoriteRecords(collection).set(key, record);
              favoriteImports.add(imported);
            }
        } else favoritesEnabled.delete(request.change.accountId);
        reply({ type: "favoriteStatus", status: favoriteStatus(collection) });
        break;
      }
      case "health":
        reply({
          type: "health",
          installed: providerPreview
            ? Object.fromEntries(
                previewProviders.map(provider => [provider.id, provider.connected]),
              )
            : { openai: true },
          agents: providerPreview
            ? previewProviders.map(provider => ({
                id: provider.id,
                label: provider.label,
                installed: provider.connected,
                credentialMethod: provider.credentialMethod,
              }))
            : [{ id: "openai", label: "OpenAI", installed: true }],
          protocolVersion: HOST_PROTOCOL_VERSION,
          version: "0.1.0",
          agentMode: "pi-sdk",
        });
        break;
      case "discoverModels":
        if (acceptance.failModelDiscovery) {
          reply({ type: "error", message: "Synthetic catalog failure" });
        } else {
          const subscription =
            request.provider === "openai" &&
            previewProviders.some(
              provider => provider.id === "openai" && provider.credentialMethod === "oauth",
            );
          reply({
            type: "discoveredModels",
            models: subscription ? [] : (acceptance.modelDirectories[request.provider] ?? []),
            source: subscription
              ? "sdk"
              : request.provider === "antigravity"
                ? "account"
                : "directory",
          });
        }
        break;
      case "agentModels":
        reply({
          type: "agentModels",
          models:
            request.settings.provider === "local" && previewLocalConfig
              ? [
                  {
                    id: previewLocalConfig.modelId,
                    label: previewLocalConfig.modelId,
                    thinkingLevels: ["off"],
                  },
                ]
              : request.settings.customModel &&
                  request.settings.modelId &&
                  !acceptance.agentModels.some(model => model.id === request.settings.modelId)
                ? [
                    ...acceptance.agentModels,
                    {
                      id: request.settings.modelId,
                      label: request.settings.modelId,
                      thinkingLevels: ["off"],
                      availability: "unknown",
                      custom: true,
                    },
                  ]
                : acceptance.agentModels,
          source: "sdk",
        });
        break;
      case "estimateGeneration": {
        const mode = new URLSearchParams(location.search).get("estimate") ?? "api";
        if (mode === "error") {
          reply({ type: "error", message: "Estimate unavailable" });
          break;
        }
        reply({
          type: "generationEstimate",
          estimate: {
            provider: request.payload.agent.provider,
            modelId: request.payload.agent.modelId || "fixture-model",
            billing: mode === "subscription" ? "subscription" : "api",
            inputTokens: 2100,
            inputCalls: 1,
            ...(mode === "api" ? { inputCostUsd: 0.0042 } : {}),
          },
        });
        break;
      }
      case "getLocalModelConfig":
        reply({
          type: "localModelConfig",
          config: previewLocalConfig,
          hasApiKey: previewLocalHasKey,
        });
        break;
      case "setLocalModelConfig":
        previewLocalHasKey =
          request.apiKey !== undefined
            ? !!request.apiKey
            : previewLocalConfig?.baseUrl === request.config.baseUrl && previewLocalHasKey;
        previewLocalConfig = request.config;
        previewProviders.find(provider => provider.id === "local")!.connected = true;
        reply({
          type: "localModelConfig",
          config: previewLocalConfig,
          hasApiKey: previewLocalHasKey,
        });
        break;
      case "testLocalModelConfig":
        if (request.config.baseUrl.includes("offline"))
          reply({ type: "error", message: "Local model connection failed." });
        else reply({ type: "localModelTest", modelIds: ["local-fixture", "local-second"] });
        break;
      case "piProviders":
        reply({
          type: "piProviders",
          providers: providerPreview
            ? previewProviders
            : [{ id: "openai", label: "OpenAI", connected: true, methods: ["api_key"] }],
        });
        break;
      case "piLogin":
        if (!providerPreview) break;
        previewLogins.set(request.id, {
          provider: request.provider,
          method: request.method,
          reply,
        });
        if (request.provider === "github-copilot" && request.method === "oauth") {
          reply({
            type: "piAuthPrompt",
            prompt: {
              promptId: crypto.randomUUID(),
              kind: "text",
              message: "GitHub Enterprise URL/domain (blank for github.com)",
            },
          });
        } else if (request.method === "api_key") {
          reply({
            type: "piAuthPrompt",
            prompt: {
              promptId: crypto.randomUUID(),
              kind: "secret",
              message: `Enter ${request.provider} API key`,
            },
          });
        } else {
          reply({
            type: "piAuthEvent",
            event: {
              message: "Complete login in your browser.",
              url: "https://example.test/login",
            },
          });
        }
        break;
      case "piAuthAnswer": {
        const login = previewLogins.get(request.loginId);
        if (!login) break;
        if (login.provider === "github-copilot") {
          login.reply({
            type: "piAuthEvent",
            event: { message: "Sign-in code: ABCD-1234", url: "https://github.com/login/device" },
          });
          break;
        }
        Object.assign(
          previewProviders.find(provider => provider.id === login.provider)!,
          {
            connected: true,
            credentialMethod: login.method,
          },
        );
        login.reply({ type: "piAuthDone" });
        previewLogins.delete(request.loginId);
        break;
      }
      case "piAuthCancel":
        previewLogins.get(request.loginId)?.reply({ type: "error", message: "Login cancelled." });
        previewLogins.delete(request.loginId);
        break;
      case "piLogout":
        if (!providerPreview) break;
        if (request.provider === "local") {
          previewLocalConfig = null;
          previewLocalHasKey = false;
        }
        Object.assign(
          previewProviders.find(provider => provider.id === request.provider)!,
          {
            connected: false,
            credentialMethod: undefined,
          },
        );
        reply({ type: "piProviders", providers: previewProviders });
        break;
      case "driveAccounts":
        reply({
          type: "driveAccounts",
          accounts: drivePreview ? previewAccounts : [],
          configured: drivePreview,
        });
        break;
      case "driveValidate":
        reply({ type: "driveValidated", accountId: request.accountId });
        break;
      case "driveFolder":
        reply({
          type: "driveFolder",
          accountId: request.accountId,
          url: "https://drive.google.com/drive/folders/backup-preview",
        });
        break;
      case "openFolder":
        reply({
          type: "folderOpened",
          directory: request.directory ?? "/Users/preview/Documents/Contextual Language Learning",
        });
        break;
      case "backupExisting": {
        const previous = jobs.get(lesson.id);
        if (previous?.backup?.status === "backed-up") {
          reply({ type: "backupsScheduled", count: 0 });
          break;
        }
        const now = new Date().toISOString();
        jobs.set(lesson.id, {
          id: lesson.id,
          sourceTitle: "Backup preview lesson",
          provider: "openai",
          status: "completed",
          completed: 1,
          total: 1,
          createdAt: now,
          updatedAt: now,
          backup: { status: "pending", accountId: previewAccount.id, updatedAt: now },
        });
        reply({ type: "backupsScheduled", count: 1 });
        break;
      }
      case "retryBackup": {
        const job = jobs.get(request.jobId)!;
        job.backup = {
          ...job.backup!,
          status: "backed-up",
          updatedAt: new Date().toISOString(),
          error: undefined,
        };
        reply({ type: "backupPublished", jobId: job.id, location: "drive-preview" });
        break;
      }
      case "listLessons":
        reply({
          type: "lessons",
          lessons: [
            {
              documentId: lesson.id,
              title: lesson.source.title,
              createdAt: lesson.createdAt,
              sourceKey: "fixture",
              targetLanguage: "en",
              level: "B1",
              sceneCount: lesson.sections.length,
            },
          ],
        });
        break;
      case "listJobs":
        reply({ type: "jobs", jobs: [...jobs.values()] });
        break;
      case "listEndedJobs":
        reply({
          type: "jobs",
          jobs: [...jobs.values()].filter(job =>
            ["completed", "failed", "cancelled"].includes(job.status),
          ),
        });
        break;
      case "listCustomDocuments":
        reply({
          type: "customDocuments",
          documents: [...docs.values()].map(doc => ({
            kind: "custom",
            documentId: doc.id,
            title: doc.title,
            createdAt: doc.createdAt,
            sourceTitle: doc.request.source.title,
          })),
        });
        break;
      case "getDocument":
        if (acceptance.favoriteSourceDeleted) {
          reply({ type: "error", message: "Source lesson deleted" });
          break;
        }
        reply({
          type: "result",
          document:
            generatedLessons.get(request.documentId) ??
            (new URLSearchParams(location.search).has("readerImport")
              ? { ...lesson, source: { ...lesson.source, platform: "import", url: undefined } }
              : favoritesPreview || new URLSearchParams(location.search).has("motionScenes")
                ? motionLesson()
                : lesson),
        });
        break;
      case "getJobPreview": {
        if (!compactFull || request.jobId !== compactFull.id) {
          reply({ type: "error", message: "No preview fixture" });
          break;
        }
        const job = jobs.get(request.jobId)!;
        reply({ type: "job", job });
        reply({
          type: "result",
          document: {
            ...compactFull,
            sections: compactFull.sections.filter(s => job.readySceneIds!.includes(s.id)),
          },
        });
        break;
      }
      case "checkDuplicates":
      case "checkCustomDuplicates":
        reply({ type: "duplicates", token: crypto.randomUUID(), matches: [] });
        break;
      case "generate": {
        if (!activityQueuePreview) {
          reply({
            type: "error",
            message: "Standard generation requires the Activity queue fixture",
          });
          break;
        }
        if (acceptance.failNextAdmission) {
          acceptance.failNextAdmission = false;
          reply({ type: "error", message: "Preview admission failed" });
          break;
        }
        queuedGenerations.set(request.payload.id, { payload: request.payload, reply });
        if (!acceptance.holdAdmission) acceptance.admitGeneration(request.payload.id);
        break;
      }
      case "cancel": {
        const job = jobs.get(request.jobId);
        if (!job) {
          reply({ type: "error", message: "Unknown preview job" });
          break;
        }
        Object.assign(job, { status: "cancelled", updatedAt: new Date().toISOString() });
        queuedGenerations.get(job.id)?.reply({ type: "job", job: { ...job } });
        reply({ type: "cancelled" });
        queuedGenerations.get(job.id)?.reply({ type: "generationSettled" });
        startNextPreviewJob();
        break;
      }
      case "generateCustom": {
        const now = new Date().toISOString();
        const doc: CustomDocument = {
          schemaVersion: "custom-v1",
          kind: "custom",
          id: request.payload.id,
          title: request.payload.source.title,
          createdAt: now,
          request: request.payload,
          execution: { ...execution, chunkPlan: [request.payload.cues.map(cue => cue.id)] },
          markdown:
            "# Acceptance notes\n\nA **safe** summary.\n\n![Blocked](https://remote.example/image.png)\n\n[Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>",
          previousDocumentId: request.payload.previousDocumentId,
        };
        docs.set(doc.id, doc);
        const job: JobSummary = {
          id: doc.id,
          kind: "custom",
          sourceTitle: doc.title,
          provider: "openai",
          status: "completed",
          completed: 1,
          total: 1,
          createdAt: now,
          updatedAt: now,
          documentId: doc.id,
          phase: "saving",
          publication: { status: "published", location: "custom-v1" },
        };
        jobs.set(job.id, job);
        reply({ type: "job", job });
        reply({
          type: "customChunk",
          resource: "document",
          resourceId: doc.id,
          index: 0,
          total: 1,
          dataBase64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(doc)))),
        });
        reply({ type: "generationSettled" });
        break;
      }
      case "getCustomDocument": {
        const doc = docs.get(request.documentId);
        if (!doc) {
          reply({ type: "error", message: "Custom document not found" });
          break;
        }
        reply({
          type: "customChunk",
          resource: "document",
          resourceId: doc.id,
          index: 0,
          total: 1,
          dataBase64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(doc)))),
        });
        break;
      }
      case "renameCustomDocument": {
        const doc = docs.get(request.documentId)!;
        docs.set(doc.id, { ...doc, title: request.title });
        reply({ type: "customDocumentChanged", documentId: doc.id });
        break;
      }
      case "deleteCustomDocument":
        docs.delete(request.documentId);
        reply({ type: "customDocumentChanged", documentId: request.documentId });
        break;
      case "getJobExecution":
        reply({ type: "jobExecution", execution });
        break;
      case "resumeBackups": {
        const pending = [...jobs.values()].filter(job => job.backup?.status === "pending");
        if (!pending.length) {
          reply({ type: "backupsFinished" });
          break;
        }
        acceptance.finishBackups = () => {
          for (const job of pending) {
            job.backup = {
              ...job.backup!,
              status: acceptance.failBackup ? "failed" : "backed-up",
              error: acceptance.failBackup ? "Preview upload failed" : undefined,
              updatedAt: new Date().toISOString(),
            };
          }
          reply({ type: "backupsFinished" });
        };
        break;
      }
      default:
        reply({ type: "error", message: "Unsupported fixture request: " + request.type });
    }
  });
  return worker;
}
const runtime = {
  id: "preview",
  onConnect,
  getManifest: () => ({ version: "0.1.0" }),
  getURL: (path: string) => "/" + path,
  connectNative: () => {
    const port = nativePort();
    generationPorts.add(port);
    port.onDisconnect.addListener(() => generationPorts.delete(port));
    return port;
  },
  lastError: undefined as { message: string } | undefined,
  sendNativeMessage: (_name: string, request: HostRequest, callback: (value: unknown) => void) => {
    try {
      const port = nativePort();
      port.onMessage.addListener(value => {
        callback(value);
        port.disconnect();
      });
      port.postMessage(request);
    } catch (error) {
      runtime.lastError = { message: String(error) };
      callback(undefined);
      runtime.lastError = undefined;
    }
  },
  connect: ({ name }: { name: string }) => {
    const [panel, worker] = portPair(name);
    onConnect.fire(worker);
    return panel;
  },
};
Object.assign(window, {
  chrome: {
    runtime,
    notifications: {
      getPermissionLevel: async () => "granted",
      create: async (id: string, copy: { title: string }) =>
        notifications.push({ id, title: copy.title }),
    },
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, saved[key]])),
        set: async (values: Record<string, unknown>) => {
          if (values.preferencesV2 && acceptance.failPreferenceWrites) {
            acceptance.preferenceWriteFailures++;
            throw new Error("Preview preference write failed");
          }
          Object.assign(saved, values);
          if (persistentMotionPreview && values.preferencesV2)
            sessionStorage.setItem(motionPreviewKey, JSON.stringify(values.preferencesV2));
        },
      },
      onChanged: event<unknown>(),
    },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      create: async (options: { url: string }) => {
        openedUrls.push(options.url);
        return tab;
      },
      update: async () => tab,
      onActivated: event<unknown>(),
      onUpdated: event<unknown>(),
      onRemoved: event<unknown>(),
      sendMessage: async (_id: number, message: { type: string }) => {
        if (message.type === "CONTEXTUAL_VIDEO_BRIDGE_STATUS")
          return { ok: true, platform: "youtube", bridgeVersion: "reader-health-v2" };
        if (message.type === "VIDEO_METADATA_GET")
          return { ok: true, title: "Acceptance video", url: tab.url };
        if (message.type === "YOUTUBE_CAPTION_TRACKS_GET")
          return { ok: true, status: "available", tracks: [{ language: "en", kind: "manual" }] };
        if (message.type === "YOUTUBE_SUBTITLES_GET")
          return {
            ok: true,
            language: "en",
            text:
              new URLSearchParams(location.search).get("captions") === "early-ending"
                ? "1\n00:00:08.040 --> 00:00:11.440\nLine 1: useful dialogue.\n\n2\n00:00:19.000 --> 00:00:21.000\n[Music]\n\n3\n00:00:23.800 --> 00:00:29.004\nLine 3: useful dialogue."
                : Array.from(
                    { length: 60 },
                    (_, i) =>
                      `${i + 1}\n00:00:${String(Math.floor(i / 2)).padStart(2, "0")},${i % 2 ? "500" : "000"} --> 00:00:${String(Math.floor((i + 1) / 2)).padStart(2, "0")},${i % 2 ? "000" : "500"}\nLine ${i + 1}: useful dialogue.\n`,
                  ).join("\n"),
          };
        return { ok: true, currentMs: 5000, durationMs: 30000, playing: false };
      },
    },
    windows: { getCurrent: async () => ({ id: 1 }), onFocusChanged: event<unknown>() },
  },
});
installGenerationController(runtime as unknown as typeof chrome.runtime, (id, title, doc, kind) => {
  void notifyAnalysisComplete(id, title, doc, kind).catch(() => {});
});
createRoot(document.getElementById("root")!).render(<App />);
