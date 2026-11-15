import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type { HostMessage, HostRequest, SystemVoice } from "@contextual/core";
import { crossCueV7Fixture } from "./reader-v7-fixture";
import { ContextualSceneReader } from "../src/components/contextual-scene-reader";
import { SystemSpeechProvider } from "../src/components/system-speech";
import { SpeechSettingsPanel } from "../src/components/speech-settings";
import { NoticeViewport } from "../src/components/notice-viewport";
import { translate } from "../src/i18n/messages";
import { SiriVoiceManagerPage } from "../src/components/siri-voice-downloads";
import { speechDownloadCopy } from "../src/i18n/speech-downloads";
import { ArrowLeft } from "lucide-react";
import { SpeechController } from "../src/native/speech-controller";
import { PreferencesStore } from "../src/lib/preferences-store";
import { Button } from "../src/components/ui/button";
import "../src/styles.css";

let playing = true;
let activeId = "";
let reply: (message: HostMessage) => void = () => {};
const requests: HostRequest[] = [];
let siriInstalled = false;
let siriResourceAvailable = false;
let installationChecks = 0;
let downloadFailure: string | null = null;
let removalFailure = false;
let siriFallbackOnly = false;
const mode = new URLSearchParams(location.search).get("mode");
const isNarrator = mode?.startsWith("narrator") ?? false;
const narratorVoices: SystemVoice[] = [
  {
    id: "narrator:local-Aria",
    name: "Microsoft Aria (Natural)",
    language: "en-US",
    engine: "narrator",
    neural: true,
    installed: true,
  },
  {
    id: "narrator:local-Nanami",
    name: "Microsoft Nanami (Natural)",
    language: "ja-JP",
    engine: "narrator",
    neural: true,
    installed: true,
  },
];
let disconnected = mode === "disconnected";
if (mode === "downloaded") siriResourceAvailable = true;
const siriVoice: SystemVoice = {
  id: "siri:mock-Aaron",
  name: "Aaron",
  language: "en-US",
  engine: "siri",
  technology: "fmvoice",
  neural: true,
  quality: "premium",
  downloadSize: 100_000_000,
  removable: true,
};
const aliasFixtures: SystemVoice[] = [
  {
    ...siriVoice,
    id: "siri:catherine",
    name: "Catherine",
    language: "en-AU",
    technology: "natural",
    installed: true,
    resourceAvailable: true,
    resourceId: "com.apple.siri.tts.voice.en_AU.catherine.natural.premium",
  },
  {
    ...siriVoice,
    id: "siri:aaron",
    name: "Aaron",
    technology: "natural",
    installed: true,
    resourceAvailable: true,
    resourceId: "com.apple.siri.tts.voice.en_US.aaron.natural.premium",
  },
  {
    ...siriVoice,
    id: "siri:aaron-old",
    name: "aaron",
    technology: "fmvoice",
    installed: true,
    resourceAvailable: true,
    resourceId: "com.apple.siri.tts.voice.en_US.aaron.natural.premium",
  },
  {
    ...siriVoice,
    id: "siri:nora",
    name: "Nora",
    technology: "natural",
    installed: true,
    resourceAvailable: true,
    resourceId: "com.apple.siri.tts.voice.en_US.nora.natural.premium",
  },
  {
    ...siriVoice,
    id: "siri:nora-old",
    name: "nora",
    technology: "fmvoice",
    installed: true,
    resourceAvailable: true,
    resourceId: "com.apple.siri.tts.voice.en_US.nora.natural.premium",
  },
];
const chineseSiriFixtures: SystemVoice[] = ["Chenghan", "Shufen"].map(name => ({
  ...siriVoice,
  id: `siri:${name.toLowerCase()}`,
  name,
  language: "zh-TW",
  technology: "neural",
  installed: true,
  resourceAvailable: true,
  resourceId: `com.apple.siri.tts.voice.zh_TW.${name.toLowerCase()}.neural.premium`,
}));
const publicFallbackFixtures: SystemVoice[] = [
  ...["Chenghan", "Shufen"].map((name, index) => ({
    id: `com.apple.ttsbundle.gryphon-neural_${name}_zh-TW_premium`,
    name: `聲音${index + 1}`,
    language: "zh-TW",
    quality: "enhanced" as const,
    neural: true,
  })),
  { id: "mock-public-ja", name: "Sakura", language: "ja-JP", neural: true },
  { id: "basic-cn", name: "Tingting", language: "zh-CN", quality: "default" },
];
const controller = new SpeechController(onMessage => {
  reply = onMessage;
  return {
    send(request) {
      if (request.type === "watch") return;
      requests.push(request);
      if (request.type === "removeSpeechVoice")
        queueMicrotask(() => {
          if (removalFailure) {
            removalFailure = false;
            reply({ id: request.id, type: "error", message: "SIRI_RESOURCE_NOT_REMOVED" });
          } else {
            siriInstalled = false;
            siriResourceAvailable = false;
            reply({ id: request.id, type: "speechVoiceRemoved", voiceId: request.voiceId });
          }
        });
      if (request.type === "getSpeechVoiceFolder" || request.type === "openSpeechVoiceFolder")
        queueMicrotask(() =>
          reply({
            id: request.id,
            type:
              request.type === "getSpeechVoiceFolder"
                ? "speechVoiceFolder"
                : "speechVoiceFolderOpened",
            voiceId: request.voiceId,
            directory:
              "/System/Library/AssetsV2/com_apple_MobileAsset_UAF_Siri_TextToSpeech/purpose_auto/" +
              (request.voiceId.toLowerCase().includes("nora")
                ? "mock-nora.asset"
                : "mock-aaron.asset"),
          }),
        );
      if (request.type === "listSpeechVoiceCatalog")
        queueMicrotask(() =>
          reply({
            id: request.id,
            type: "speechVoiceCatalog",
            catalog: {
              available:
                !isNarrator &&
                !siriFallbackOnly &&
                !["unsupported", "no-siri"].includes(mode ?? ""),
              voices:
                mode === "siri-priority"
                  ? siriFallbackOnly
                    ? []
                    : [
                        ...chineseSiriFixtures,
                        aliasFixtures.find(voice => voice.id === "siri:nora")!,
                      ]
                  : mode === "aliases"
                    ? aliasFixtures
                    : [
                        {
                          ...siriVoice,
                          installed: siriInstalled,
                          resourceAvailable: siriResourceAvailable,
                        },
                      ],
            },
          }),
        );
      if (request.type === "installSpeechVoice")
        queueMicrotask(() => {
          if (downloadFailure) {
            reply({ id: request.id, type: "error", message: downloadFailure });
            downloadFailure = null;
            return;
          }
          reply({
            id: request.id,
            type: "speechVoiceInstallation",
            installation: { voiceId: request.voiceId, status: "requested" },
          });
        });
      if (request.type === "getSpeechVoiceInstallation")
        queueMicrotask(() => {
          siriInstalled = ++installationChecks >= 2;
          siriResourceAvailable = siriInstalled;
          reply({
            id: request.id,
            type: "speechVoiceInstallation",
            installation: {
              voiceId: request.voiceId,
              status: siriInstalled ? "installed" : "not-installed",
            },
          });
        });
      if (request.type === "listSpeechVoices")
        queueMicrotask(() => {
          if (disconnected) {
            reply({ id: request.id, type: "error", message: "Native Host is not installed" });
            return;
          }
          reply({
            id: request.id,
            type: "speechVoices",
            supported: mode !== "unsupported",
            experimentalBackend: isNarrator ? "windows-narrator" : undefined,
            voices: isNarrator
              ? mode === "narrator-empty"
                ? []
                : narratorVoices
              : mode === "unsupported"
                ? []
                : mode === "missing-language"
                  ? [{ id: "basic", name: "Basic", language: "en-US", quality: "default" }]
                  : mode === "siri-priority"
                    ? [...(siriFallbackOnly ? [] : chineseSiriFixtures), ...publicFallbackFixtures]
                    : [
                        ...(mode === "aliases"
                          ? aliasFixtures
                          : siriInstalled
                            ? [{ ...siriVoice, installed: true }]
                            : []),
                        { id: "Alex", name: "Alex", language: "en-US" },
                        { id: "Samantha", name: "Samantha", language: "en-US", quality: "default" },
                        {
                          id: "Samantha-enhanced",
                          name: "Samantha",
                          language: "en-US",
                          quality: "enhanced",
                        },
                        {
                          id: "mock-neural-en",
                          name: "Voice 2",
                          language: "en-US",
                          quality: "enhanced",
                          neural: true,
                        },
                        { id: "Kyoko", name: "Kyoko", language: "ja-JP" },
                        {
                          id: "mock-neural-tw",
                          name: "聲音2",
                          language: "zh-TW",
                          quality: "enhanced",
                          neural: true,
                        },
                        { id: "Tingting", name: "Tingting", language: "zh-CN", quality: "default" },
                      ],
          });
        });
      if (request.type === "speak") {
        if (activeId) reply({ id: activeId, type: "speechFinished", status: "stopped" });
        activeId = request.id;
      }
      if (request.type === "stopSpeech")
        queueMicrotask(() => {
          if (activeId === request.speechId) {
            reply({ id: activeId, type: "speechFinished", status: "stopped" });
            activeId = "";
          }
          reply({ id: request.id, type: "speechStopped" });
        });
    },
    close() {
      activeId = "";
    },
  };
});
const saved = new Map<string, unknown>();
const storage = {
  get: async (keys: string[] | string) =>
    Object.fromEntries(
      (typeof keys === "string" ? [keys] : keys).map(key => [key, saved.get(key)]),
    ),
  set: async (values: Record<string, unknown>) => {
    Object.entries(values).forEach(([key, value]) => saved.set(key, value));
  },
};
Object.assign(window, {
  chrome: { storage: { local: storage } },
  __speechPreview: {
    requests,
    saveLegacyAlias() {
      return store.saveSpeech({ rate: 0.75, voices: { en: "siri:aaron-old" } });
    },
    savePublicPreference() {
      return store.saveSpeech({
        rate: 0.75,
        voices: { "zh-TW": "com.apple.ttsbundle.gryphon-neural_Shufen_zh-TW_premium" },
      });
    },
    usePublicFallback() {
      siriFallbackOnly = true;
    },
    recover() {
      disconnected = false;
    },
    rejectNextDownload(message: string) {
      downloadFailure = message;
    },
    rejectNextRemoval() {
      removalFailure = true;
    },
    resourceOnly() {
      siriInstalled = false;
      siriResourceAvailable = true;
    },
    playing: () => playing,
    settings: () => store.current().speech,
    complete() {
      if (activeId) reply({ id: activeId, type: "speechFinished", status: "completed" });
      activeId = "";
    },
    fail() {
      if (activeId) reply({ id: activeId, type: "error", message: "Audio unavailable" });
      activeId = "";
    },
  },
});
const store = new PreferencesStore(storage);
const doc = crossCueV7Fixture();
const adapter = {
  id: "import",
  label: "Preview",
  getVideoId: () => "preview",
  status: async () => ({ currentMs: 1500, playing }),
  pause: async () => {
    playing = false;
  },
  stopLoop: async () => {
    playing = false;
  },
  loop: async () => {
    playing = true;
  },
};
function Preview() {
  const [rate, setRate] = useState(1);
  const [settings, setSettings] = useState(false);
  const [resourcesLanguage, setResourcesLanguage] = useState<string | null>(null);
  const [manageFocus, setManageFocus] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState(mode === "siri-priority" ? "zh-TW" : "en");
  return (
    <SystemSpeechProvider store={store} controller={controller}>
      <NoticeViewport
        error=""
        notice=""
        dismiss={() => {}}
        closeLabel={translate("zh-TW", "closeNotification")}
        regionLabel={translate("zh-TW", "notificationsRegion")}
        theme="light"
        locale="zh-TW"
      />
      <div className="mx-auto flex h-dvh max-w-[480px] flex-col gap-2 bg-background p-3 text-foreground">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setResourcesLanguage(null);
            setSettings(value => !value);
          }}
        >
          聲音設定
        </Button>
        {settings && resourcesLanguage ? (
          <>
            <header className="shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setResourcesLanguage(null);
                  setManageFocus(true);
                }}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {speechDownloadCopy("zh-TW").back}
              </Button>
              <h2 className="mt-2 text-sm font-semibold">{speechDownloadCopy("zh-TW").title}</h2>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SiriVoiceManagerPage locale="zh-TW" defaultLanguage={resourcesLanguage} />
            </div>
          </>
        ) : settings ? (
          <div className="min-h-0 overflow-y-auto">
            <SpeechSettingsPanel
              locale="zh-TW"
              defaultLanguage={speechLanguage}
              onManageVoices={language => {
                setManageFocus(false);
                setSpeechLanguage(language);
                setResourcesLanguage(language);
              }}
              restoreManageFocus={manageFocus ? () => setManageFocus(false) : undefined}
            />
          </div>
        ) : (
          <ContextualSceneReader
            document={doc}
            adapter={adapter}
            locale="zh-TW"
            repeat="2"
            setRepeat={() => {}}
            delay={0}
            setDelay={() => {}}
            sceneRepeat="2"
            setSceneRepeat={() => {}}
            sceneDelay={0}
            setSceneDelay={() => {}}
            playbackRate={rate}
            setPlaybackRate={setRate}
            onError={() => {}}
            onNotice={() => {}}
            onSaveRange={async () => {}}
            onSaveSceneRange={async () => {}}
          />
        )}
      </div>
    </SystemSpeechProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
