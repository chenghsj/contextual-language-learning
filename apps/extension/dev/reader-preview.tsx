import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ContextualSceneReader } from "../src/components/contextual-scene-reader";
import { withSentenceTiming } from "@contextual/core";
import type { VideoAdapter } from "../src/video/types";
import { document as fixture } from "./reader-fixture";
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
  const [doc, setDoc] = useState({
    ...fixture,
    sections: [
      fixture.sections[0],
      { ...fixture.sections[0], id: "00000000-0000-4000-8000-000000000003", title: "Making plans" },
    ],
  });
  const [rate, setRate] = useState(1);
  const [notice, setNotice] = useState(
    new URLSearchParams(location.search).has("episode")
      ? "舊版完整教材預覽已封存，目前顯示合成測試資料。"
      : "",
  );
  return (
    <div className="mx-auto flex h-dvh max-w-[480px] flex-col bg-background p-3 text-foreground">
      <p className="shrink-0 pb-2 text-xs text-muted-foreground">
        閱讀驗收預覽 · 合成資料與模擬播放
      </p>
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
createRoot(document.getElementById("root")!).render(<Preview />);
