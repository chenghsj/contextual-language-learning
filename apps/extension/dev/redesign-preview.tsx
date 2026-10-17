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
  validateLearningDocumentV7,
  type HostRequest,
  type HostMessage,
  type CustomDocument,
  type JobSummary,
  type PiProviderInfo,
  type AgentModel,
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
const persistentMotionPreview = new URLSearchParams(location.search).has("motionAcceptance");
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
const previewProviders = [
  { id: "openai", label: "OpenAI", connected: true, methods: ["api_key", "oauth"] },
  { id: "anthropic", label: "Anthropic", connected: false, methods: ["api_key", "oauth"] },
  { id: "google", label: "Google", connected: true, methods: ["api_key"] },
  { id: "github-copilot", label: "GitHub Copilot", connected: false, methods: ["oauth"] },
];
const previewLogins = new Map<
  string,
  { provider: string; reply: (message: Record<string, unknown>) => void }
>();
const drivePreview = storagePreview || new URLSearchParams(location.search).get("drive") === "1";
const previewAccount = { id: "drive-preview", email: "learner@example.test" };
const previewAccounts = storagePreview
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
const openedUrls: string[] = [];
const acceptance = {
  commands,
  docs,
  jobs,
  notifications,
  hostRegistered: true,
  nativeConnections: 0,
  agentModels: [{ id: "fixture-model", label: "Fixture model" }] as AgentModel[],
  failBackup: false,
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
      previewProviders.find(provider => provider.id === providerId)!.connected = true;
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
              }))
            : [{ id: "openai", label: "OpenAI", installed: true }],
          protocolVersion: HOST_PROTOCOL_VERSION,
          version: "0.1.0",
          agentMode: "pi-sdk",
        });
        break;
      case "agentModels":
        reply({
          type: "agentModels",
          models: acceptance.agentModels,
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
        previewLogins.set(request.id, { provider: request.provider, reply });
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
        previewProviders.find(provider => provider.id === login.provider)!.connected = true;
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
        previewProviders.find(provider => provider.id === request.provider)!.connected = false;
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
        reply({
          type: "result",
          document:
            generatedLessons.get(request.documentId) ??
            (new URLSearchParams(location.search).has("readerImport")
              ? { ...lesson, source: { ...lesson.source, platform: "import", url: undefined } }
              : new URLSearchParams(location.search).has("motionScenes")
                ? motionLesson()
                : lesson),
        });
        break;
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
