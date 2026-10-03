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
  type HostRequest,
  type HostMessage,
  type CustomDocument,
  type JobSummary,
} from "@immersive/core";
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
const preferences = {
  ...defaultPreferences("zh-TW"),
  uiLocalePreference: "zh-TW",
  themePreference: new URLSearchParams(location.search).get("theme") ?? "light",
  agent: { provider: "openai", modelId: "fixture-model" },
  providerSettings: { openai: { provider: "openai", modelId: "fixture-model" } },
};
const saved: Record<string, unknown> = { preferencesV2: preferences };
const docs = new Map<string, CustomDocument>();
const jobs = new Map<string, JobSummary>();
const commands: HostRequest[] = [];
const notifications: { id: string; title: string }[] = [];
Object.assign(window, { acceptance: { commands, docs, jobs, notifications } });
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
          installed: { openai: true },
          agents: [{ id: "openai", label: "OpenAI", installed: true }],
          protocolVersion: HOST_PROTOCOL_VERSION,
          version: "0.1.0",
          agentMode: "pi-sdk",
        });
        break;
      case "agentModels":
        reply({
          type: "agentModels",
          models: [{ id: "fixture-model", label: "Fixture model" }],
          source: "sdk",
        });
        break;
      case "piProviders":
        reply({
          type: "piProviders",
          providers: [{ id: "openai", label: "OpenAI", connected: true, methods: ["api_key"] }],
        });
        break;
      case "driveAccounts":
        reply({ type: "driveAccounts", accounts: [], configured: false });
        break;
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
      case "listEndedJobs":
        reply({ type: "jobs", jobs: [...jobs.values()] });
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
        reply({ type: "result", document: lesson });
        break;
      case "checkDuplicates":
      case "checkCustomDuplicates":
        reply({ type: "duplicates", token: crypto.randomUUID(), matches: [] });
        break;
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
      case "resumeBackups":
        reply({ type: "backupsFinished" });
        break;
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
  connectNative: nativePort,
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
        set: async (values: Record<string, unknown>) => Object.assign(saved, values),
      },
      onChanged: event<unknown>(),
    },
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      create: async () => tab,
      update: async () => tab,
      onActivated: event<unknown>(),
      onUpdated: event<unknown>(),
      onRemoved: event<unknown>(),
      sendMessage: async (_id: number, message: { type: string }) => {
        if (message.type === "IMMERSIVE_VIDEO_BRIDGE_STATUS")
          return { ok: true, platform: "youtube", bridgeVersion: "reader-health-v2" };
        if (message.type === "VIDEO_METADATA_GET")
          return { ok: true, title: "Acceptance video", url: tab.url };
        if (message.type === "YOUTUBE_CAPTION_TRACKS_GET")
          return { ok: true, status: "available", tracks: [{ language: "en", kind: "manual" }] };
        if (message.type === "YOUTUBE_SUBTITLES_GET")
          return {
            ok: true,
            language: "en",
            text: Array.from(
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
