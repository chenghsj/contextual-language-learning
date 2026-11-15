import React, { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type {
  HostMessage,
  HostRequest,
  SpeechDownloadId,
  SpeechDownloadSnapshot,
  SpeechDownloadTask,
  SystemVoice,
} from "@contextual/core";
import { SpeechDownloadIdSchema } from "@contextual/core";
import {
  messages,
  translate,
  type UiLocale,
  type MessageKey,
  type MessageParams,
} from "../src/i18n/messages";
import { SpeechController } from "../src/native/speech-controller";
import { SystemSpeechProvider } from "../src/components/system-speech";
import {
  SpeechDownloadsProvider,
  type SpeechDownloadsPort,
} from "../src/components/speech-downloads-provider";
import { SiriVoiceManagerPage } from "../src/components/siri-voice-downloads";
import { TaskHistory } from "../src/components/task-history";
import { NoticeViewport } from "../src/components/notice-viewport";
import { HeaderActions } from "../src/components/header-actions";
import { speechDownloadTaskCopy } from "../src/i18n/speech-download-task";
import { Button } from "../src/components/ui/button";
import "../src/styles.css";

const voices: SystemVoice[] = [
  {
    id: "siri:aaron",
    name: "Aaron",
    language: "en-US",
    engine: "siri",
    installed: false,
    resourceAvailable: false,
    downloadSize: 150_000_000,
  },
  {
    id: "siri:nora",
    name: "Nora",
    language: "en-US",
    engine: "siri",
    installed: false,
    resourceAvailable: false,
    downloadSize: 100_000_000,
  },
  {
    id: "siri:chunmei",
    name: "春梅",
    language: "zh-TW",
    engine: "siri",
    installed: false,
    resourceAvailable: false,
  },
];
const id = () => SpeechDownloadIdSchema.parse(crypto.randomUUID());
const now = () => new Date().toISOString();
class FixtureDownloads implements SpeechDownloadsPort {
  private value: SpeechDownloadSnapshot = {
    type: "speechDownloadSnapshot",
    ready: true,
    revision: 1,
    service: "ready",
    paused: false,
    tasks: [],
  };
  private listeners = new Set<() => void>();
  private notices = new Set<(task: SpeechDownloadTask) => void>();
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  subscribeNotices = (listener: (task: SpeechDownloadTask) => void) => {
    this.notices.add(listener);
    return () => {
      this.notices.delete(listener);
    };
  };
  private update(tasks: SpeechDownloadTask[]) {
    this.value = { ...this.value, revision: this.value.revision + 1, tasks };
    this.listeners.forEach(listener => listener());
  }
  async start(voiceId: string): Promise<SpeechDownloadId> {
    const voice = voices.find(item => item.id === voiceId);
    if (!voice) throw new Error("Unknown voice");
    const taskId = id();
    this.update([
      {
        id: taskId,
        voice,
        createdAt: now(),
        updatedAt: now(),
        progress: { status: "waiting-system" },
        observation: { kind: "fresh", checkedAt: now() },
      },
      ...this.value.tasks,
    ]);
    return taskId;
  }
  async cancel(taskId: SpeechDownloadId): Promise<void> {
    this.finish(taskId, { status: "cancelled", endedAt: now(), shared: true });
  }
  async retry(taskId: SpeechDownloadId): Promise<SpeechDownloadId> {
    const task = this.value.tasks.find(item => item.id === taskId);
    if (!task) throw new Error("Task missing");
    return this.start(task.voice.id);
  }
  async clearEnded(ids: SpeechDownloadId[]): Promise<void> {
    this.update(this.value.tasks.filter(task => !ids.includes(task.id)));
  }
  async reconcile(): Promise<void> {
    this.value = { ...this.value, service: "ready", paused: false };
    this.listeners.forEach(listener => listener());
  }
  close() {}
  finish(taskId: SpeechDownloadId, progress: SpeechDownloadTask["progress"]) {
    const task = this.value.tasks.find(item => item.id === taskId);
    if (!task) return;
    const updated = { ...task, progress, updatedAt: now() };
    this.update(this.value.tasks.map(item => (item.id === taskId ? updated : item)));
    if (progress.status === "completed" || progress.status === "failed")
      this.notices.forEach(listener => listener(updated));
  }
  service(service: SpeechDownloadSnapshot["service"]) {
    this.value = { ...this.value, service, paused: service === "unavailable" };
    this.listeners.forEach(listener => listener());
  }
}
const downloads = new FixtureDownloads();
let removalFailure = false;
const speech = new SpeechController(onMessage => ({
  send(request: HostRequest) {
    const respond = (message: HostMessage) => queueMicrotask(() => onMessage(message));
    if (request.type === "listSpeechVoices")
      respond({
        id: request.id,
        type: "speechVoices",
        supported: true,
        voices: voices.filter(voice => voice.installed),
      });
    if (request.type === "listSpeechVoiceCatalog")
      respond({
        id: request.id,
        type: "speechVoiceCatalog",
        catalog: { available: true, voices },
      });
    if (request.type === "getSpeechVoiceFolder")
      respond({
        id: request.id,
        type: "speechVoiceFolder",
        voiceId: request.voiceId,
        directory: "/System/Library/AssetsV2/fixture",
      });
    if (request.type === "openSpeechVoiceFolder")
      respond({
        id: request.id,
        type: "speechVoiceFolderOpened",
        voiceId: request.voiceId,
        directory: "/System/Library/AssetsV2/fixture",
      });
    if (request.type === "removeSpeechVoice") {
      if (removalFailure) {
        removalFailure = false;
        respond({ id: request.id, type: "error", message: "Removal not confirmed" });
        return;
      }
      const voice = voices.find(item => item.id === request.voiceId);
      if (voice) {
        voice.installed = false;
        voice.resourceAvailable = false;
        voice.removable = false;
      }
      respond({
        id: request.id,
        type: "speechVoiceRemoved",
        voiceId: request.voiceId,
      });
    }
  },
  close() {},
}));
const parameters = new URLSearchParams(location.search);
function isLocale(value: string | null): value is UiLocale {
  return value !== null && Object.hasOwn(messages, value);
}
const languageChoice = parameters.get("locale");
const locale: UiLocale = isLocale(languageChoice) ? languageChoice : "zh-TW";
const t = (key: MessageKey, params?: MessageParams) => translate(locale, key, params);
document.documentElement.classList.toggle("dark", parameters.get("theme") === "dark");
if (parameters.get("motion") === "reduced") document.documentElement.dataset.motion = "reduced";
function Preview() {
  const [page, setPage] = useState<"activity" | "settings">("settings");
  const [focusVoice, setFocusVoice] = useState<{
    id: string;
    tab: "installed" | "downloadable";
  } | null>(null);
  const [language, setLanguage] = useState("en-US");
  const snapshot = useSyncExternalStore(downloads.subscribe, downloads.snapshot);
  const active = snapshot.tasks.filter(task =>
    ["requesting", "waiting-system", "cancelling"].includes(task.progress.status),
  );
  const finish = (status: "completed" | "failed") => {
    const task = active[0];
    if (!task) return;
    if (status === "completed") {
      const voice = voices.find(item => item.id === task.voice.id);
      if (voice) {
        voice.installed = true;
        voice.resourceAvailable = true;
        voice.removable = true;
      }
    }
    downloads.finish(
      task.id,
      status === "completed"
        ? { status, endedAt: now() }
        : { status, endedAt: now(), reason: "rejected" },
    );
  };
  return (
    <div className="mx-auto flex h-dvh max-w-[400px] flex-col bg-background px-4 text-foreground">
      <NoticeViewport
        error=""
        notice=""
        dismiss={() => {}}
        closeLabel={t("closeNotification")}
        regionLabel={t("notificationsRegion")}
        theme={parameters.get("theme") === "dark" ? "dark" : "light"}
        locale={locale}
      />
      <header className="flex items-center justify-between border-b border-border py-3">
        <strong className="text-ui-heading">Contextual Language Learning</strong>
        <HeaderActions
          locale={locale}
          page={page}
          downloadActiveCount={active.length}
          onActivity={() => setPage("activity")}
          onSettings={() => setPage("settings")}
        />
      </header>
      <nav
        aria-label="Fixture controls"
        className="flex flex-wrap gap-1 border-b border-border py-2"
      >
        <Button size="sm" variant="outline" onClick={() => void downloads.start("siri:aaron")}>
          Start Aaron
        </Button>
        <Button size="sm" variant="outline" onClick={() => void downloads.start("siri:nora")}>
          Start Nora
        </Button>
        <Button size="sm" variant="outline" onClick={() => finish("completed")}>
          Complete first
        </Button>
        <Button size="sm" variant="outline" onClick={() => finish("failed")}>
          Fail first
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            removalFailure = true;
          }}
        >
          Fail next removal
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloads.service("unavailable")}>
          Disconnect
        </Button>
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto py-4">
        {page === "settings" ? (
          <SiriVoiceManagerPage
            locale={locale}
            defaultLanguage={language}
            focusVoice={focusVoice}
          />
        ) : (
          <TaskHistory
            jobs={[]}
            loadingJobs={false}
            hostReady
            generating={false}
            storageBusy={false}
            agentCatalog={[]}
            locale={locale}
            t={t}
            onRefresh={() => {}}
            onResume={() => {}}
            onOpen={() => {}}
            onRetryPublication={async () => {}}
            onRetryBackup={async () => {}}
            onViewVoice={task => {
              setLanguage(task.voice.language);
              setFocusVoice({
                id: task.voice.id,
                tab: task.progress.status === "completed" ? "installed" : "downloadable",
              });
              setPage("settings");
            }}
          />
        )}
      </main>
      <p className="border-t border-border py-2 text-ui-meta text-muted-foreground">
        {speechDownloadTaskCopy[locale].title} · UI fixture
      </p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <SpeechDownloadsProvider client={downloads}>
    <SystemSpeechProvider controller={speech}>
      <Preview />
    </SystemSpeechProvider>
  </SpeechDownloadsProvider>,
);
