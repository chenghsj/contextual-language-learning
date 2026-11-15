import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ContextualSceneReader } from "../src/components/contextual-scene-reader";
import { SystemSpeechProvider } from "../src/components/system-speech";
import { SpeechController } from "../src/native/speech-controller";
import {
  withSentenceTiming,
  validateLearningDocumentV7,
  type LearningDocument,
} from "@contextual/core";
import type { VideoAdapter } from "../src/video/types";
import { messages, type UiLocale } from "../src/i18n/messages";
import {
  v7Fixture,
  withinCueV7Fixture,
  crossCueV7Fixture,
  readingGapV7Fixture,
  longReadingV7Fixture,
} from "./reader-v7-fixture";
import { document as fixture } from "./reader-fixture";
import { chineseLearningFixture } from "../../../packages/core/test/chinese-learning-fixture";
import "../src/styles.css";

const saved = new Map<string, unknown>();
Object.assign(window, {
  chrome: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: saved.get(key) }),
        set: async (value: Record<string, unknown>) =>
          Object.entries(value).forEach(([key, item]) => saved.set(key, item)),
      },
    },
  },
});
let currentMs = 1000,
  playing = false;
let active: { startMs: number; endMs: number; repeats: number | "infinite" } | null = null;
setInterval(() => {
  if (!playing) return;
  currentMs += 100;
  if (active && currentMs >= active.endMs) {
    if (active.repeats === "infinite") currentMs = active.startMs;
    else {
      currentMs = active.endMs;
      playing = false;
      active = null;
    }
  }
}, 100);
const adapter: VideoAdapter = {
  id: "preview",
  label: "Preview",
  getVideoId: () => "preview",
  status: async () => ({ currentMs, playing }),
  seek: async (_url, ms) => {
    currentMs = ms;
    playing = true;
  },
  play: async () => {
    playing = true;
  },
  pause: async () => {
    playing = false;
  },
  loop: async (_url, settings) => {
    active = settings;
    currentMs = settings.resumeMs ?? settings.startMs;
    playing = true;
  },
  stopLoop: async () => {
    active = null;
  },
  setPlaybackRate: async () => undefined,
};
function Preview() {
  const localeParam = new URLSearchParams(location.search).get("locale");
  const previewLocale: UiLocale =
    localeParam && localeParam in messages ? (localeParam as UiLocale) : "zh-TW";
  const params = new URLSearchParams(location.search);
  const [doc, setDoc] = useState<LearningDocument>(() =>
    params.has("chinese")
      ? chineseLearningFixture(params.get("chinese") === "zh-CN" ? "zh-CN" : "zh-TW").document
      : params.has("multi")
        ? withinCueV7Fixture()
        : params.has("cross")
          ? crossCueV7Fixture()
          : params.has("gaps")
            ? readingGapV7Fixture()
            : params.has("long")
              ? longReadingV7Fixture(params.get("long") === "ko" ? "ko" : "ja")
              : v7Fixture,
  );
  const [rate, setRate] = useState(1);
  const [notice, setNotice] = useState("");
  const episode = params.get("episode");
  useEffect(() => {
    if (episode !== "N3" && episode !== "N1") return;
    const controller = new AbortController();
    const manifestUrl = new URL("../../../docs/quality/v7/full/requests.json", import.meta.url);
    void (async () => {
      const response = await fetch(manifestUrl, { signal: controller.signal });
      if (!response.ok) throw new Error("無法讀取完整教材驗收請求");
      const manifest = await response.json();
      const entry = manifest.find((e: any) => e.request.profile.level === episode);
      if (!entry) throw new Error("找不到該程度的驗收請求");
      const result = await fetch(new URL(`${episode}-${entry.request.id}.json`, manifestUrl), {
        signal: controller.signal,
      });
      if (!result.ok) throw new Error("完整教材草稿尚未生成");
      setDoc(validateLearningDocumentV7(await result.json()));
    })().catch(error => {
      if (!controller.signal.aborted) setNotice(String(error));
    });
    return () => controller.abort();
  }, [episode]);
  return (
    <div
      className={
        "mx-auto flex h-dvh flex-col bg-background p-3 text-foreground " +
        (new URLSearchParams(location.search).has("wide") ? "max-w-none" : "max-w-[480px]")
      }
    >
      <p className="shrink-0 pb-2 text-xs text-muted-foreground">
        V7 閱讀驗收預覽 · {episode ? "完整草稿與模擬播放" : "合成資料與模擬播放"}
        {params.get("speech") === "mock" && " · 模擬朗讀（不發聲）"}
      </p>
      <ContextualSceneReader
        key={doc.id}
        document={doc}
        adapter={adapter}
        locale={previewLocale}
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
        onError={setNotice}
        onNotice={setNotice}
        onSaveRange={async (id, range) => setDoc(withSentenceTiming(doc, id, range))}
        onSaveSceneRange={async (id, range) => {
          const overrides = { ...doc.scenePlaybackOverrides };
          if (range) overrides[id] = range;
          else delete overrides[id];
          setDoc({ ...doc, scenePlaybackOverrides: overrides });
        }}
      />
      {notice && (
        <p role="status" className="shrink-0 text-xs">
          {notice}
        </p>
      )}
    </div>
  );
}
const mockSpeech =
  new URLSearchParams(location.search).get("speech") === "mock"
    ? new SpeechController(onMessage => ({
        close() {},
        send(request) {
          queueMicrotask(() => {
            if (request.type === "listSpeechVoices")
              onMessage({
                id: request.id,
                type: "speechVoices",
                supported: true,
                voices: ["en", "ja", "ko"].map(language => ({
                  id: language,
                  name: "Preview " + language,
                  language,
                  quality: "enhanced" as const,
                })),
              });
            else if (request.type === "speak")
              onMessage({ id: request.id, type: "speechFinished", status: "completed" });
            else if ("id" in request) onMessage({ id: request.id, type: "speechStopped" });
          });
        },
      }))
    : undefined;
createRoot(document.getElementById("root")!).render(
  mockSpeech ? (
    <SystemSpeechProvider controller={mockSpeech}>
      <Preview />
    </SystemSpeechProvider>
  ) : (
    <Preview />
  ),
);
