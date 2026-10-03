import { isVideoCommandErrorCode, type VideoCommandErrorCode } from "../video/command-errors";
import type { LearningLanguage } from "@immersive/core";
import {
  VIDEO_READER_STATUS,
  VIDEO_READER_VERSION,
  RELOAD_READER_MESSAGE,
} from "../video/reader-health";

type LoopMessage =
  | {
      type: "LOOP_SET";
      startMs: number;
      endMs: number;
      repeats: number | "infinite";
      delaySeconds: number;
      resumeMs?: number;
    }
  | { type: "LOOP_CLEAR" }
  | { type: "PLAYBACK_PLAY" | "PLAYBACK_PAUSE" }
  | { type: "VIDEO_METADATA_GET" }
  | { type: "YOUTUBE_SEEK"; timeMs: number }
  | { type: "PLAYBACK_RATE_SET"; rate: number }
  | { type: "PLAYBACK_STATUS_GET" }
  | { type: "YOUTUBE_SUBTITLES_GET"; videoId: string; language: LearningLanguage }
  | { type: "YOUTUBE_CAPTION_TRACKS_GET"; videoId: string }
  | { type: typeof VIDEO_READER_STATUS };

let active: {
  video: HTMLVideoElement;
  start: number;
  end: number;
  repeats: number | "infinite";
  completed: number;
  delayMs: number;
} | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let managedPause = false;
let internalSeek = false;

function clearLoop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (active) {
    active.video.removeEventListener("timeupdate", onTimeUpdate);
    active.video.removeEventListener("pause", onPause);
    active.video.removeEventListener("seeking", onSeeking);
  }
  active = null;
  managedPause = false;
  internalSeek = false;
}

function seek(video: HTMLVideoElement, position: number): void {
  internalSeek = true;
  video.addEventListener(
    "seeked",
    () => {
      internalSeek = false;
    },
    { once: true },
  );
  video.currentTime = position;
}

function onPause(): void {
  if (active && !managedPause) clearLoop();
}

function onSeeking(): void {
  if (active && !internalSeek) clearLoop();
}

function onTimeUpdate(): void {
  const state = active;
  if (!state || timer !== null || state.video.currentTime < state.end) return;
  state.completed += 1;
  if (state.repeats !== "infinite" && state.completed >= state.repeats) {
    managedPause = true;
    state.video.pause();
    clearLoop();
    return;
  }
  managedPause = true;
  state.video.pause();
  timer = setTimeout(() => {
    timer = null;
    if (active !== state) return;
    seek(state.video, state.start);
    managedPause = false;
    void state.video.play().catch(() => clearLoop());
  }, state.delayMs);
}

type CaptionResponse = {
  source: "immersive-learning";
  id: string;
  ok: boolean;
  bridgeVersion?: string;
  text?: string;
  language?: string;
  error?: string;
  errorCode?: VideoCommandErrorCode;
};

function requestYouTubeCaptions(videoId: string, language: string): Promise<CaptionResponse> {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const RESPONSE = "immersive-learning:youtube:caption-response";
    const timer = setTimeout(() => {
      window.removeEventListener(RESPONSE, receive);
      resolve({
        source: "immersive-learning",
        id,
        ok: false,
        error: "YouTube subtitle reader did not respond. Reload this video tab and retry.",
      });
    }, 32_000);
    function receive(event: Event): void {
      const reply = (event as CustomEvent<CaptionResponse>).detail;
      if (reply?.source !== "immersive-learning" || reply.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener(RESPONSE, receive);
      resolve(reply);
    }
    window.addEventListener(RESPONSE, receive);
    window.dispatchEvent(
      new CustomEvent("immersive-learning:youtube:caption-request", {
        detail: { source: "immersive-learning", id, videoId, language },
      }),
    );
  });
}

function requestYouTubeTrackList(videoId: string): Promise<{
  source: string;
  id: string;
  ok: boolean;
  bridgeVersion?: string;
  status?: string;
  tracks?: { language: string; kind: "manual" | "auto" }[];
  error?: string;
}> {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const eventName = "immersive-learning:youtube:track-response";
    const timer = setTimeout(() => {
      window.removeEventListener(eventName, receive);
      resolve({
        source: "immersive-learning",
        id,
        ok: false,
        error: "Caption metadata timed out.",
      });
    }, 4_000);
    function receive(event: Event): void {
      const result = (
        event as CustomEvent<{
          source: string;
          id: string;
          ok: boolean;
          bridgeVersion?: string;
          status?: string;
          tracks?: { language: string; kind: "manual" | "auto" }[];
          error?: string;
        }>
      ).detail;
      if (result?.source !== "immersive-learning" || result.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener(eventName, receive);
      resolve(result);
    }
    window.addEventListener(eventName, receive);
    window.dispatchEvent(
      new CustomEvent("immersive-learning:youtube:track-request", {
        detail: { source: "immersive-learning", id, videoId },
      }),
    );
  });
}

function youtubePageReaderReady(): Promise<boolean> {
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const responseEvent = "immersive-learning:youtube:bridge-health-response";
    const timer = setTimeout(() => {
      window.removeEventListener(responseEvent, receive);
      resolve(false);
    }, 900);
    function receive(event: Event): void {
      const reply = (
        event as CustomEvent<{
          source?: string;
          id?: string;
          bridgeVersion?: string;
        }>
      ).detail;
      if (reply?.source !== "immersive-learning" || reply.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener(responseEvent, receive);
      resolve(reply.bridgeVersion === "native-caption-capture-v2");
    }
    window.addEventListener(responseEvent, receive);
    window.dispatchEvent(
      new CustomEvent("immersive-learning:youtube:bridge-health-request", {
        detail: { source: "immersive-learning", id },
      }),
    );
  });
}

chrome.runtime.onMessage.addListener((message: LoopMessage, _sender, respond) => {
  if (message.type === VIDEO_READER_STATUS) {
    void youtubePageReaderReady().then(ready =>
      respond(
        ready
          ? { ok: true, platform: "youtube", bridgeVersion: VIDEO_READER_VERSION }
          : { ok: false, error: RELOAD_READER_MESSAGE },
      ),
    );
    return true;
  }
  if (message.type === "VIDEO_METADATA_GET") {
    const title =
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ??
      document.querySelector('meta[property="og:title"]')?.getAttribute("content") ??
      document.title;
    respond({ ok: true, url: location.href, title });
    return false;
  }
  if (message.type === "YOUTUBE_CAPTION_TRACKS_GET") {
    const videoId = new URL(location.href).searchParams.get("v");
    if (location.pathname !== "/watch" || videoId !== message.videoId) {
      respond({ ok: false, error: "The active YouTube video changed." });
      return false;
    }
    void requestYouTubeTrackList(message.videoId)
      .then(result => {
        if (!result.ok || result.bridgeVersion !== "native-caption-capture-v2") {
          respond({ ok: false, error: result.error ?? RELOAD_READER_MESSAGE });
          return;
        }
        const tracks = Array.isArray(result.tracks)
          ? result.tracks
              .filter(
                track =>
                  typeof track?.language === "string" &&
                  /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(track.language) &&
                  (track.kind === "manual" || track.kind === "auto"),
              )
              .slice(0, 100)
          : [];
        respond({
          ok: true,
          status: result.status === "available" ? "available" : "unknown",
          tracks,
        });
      })
      .catch(() => respond({ ok: false, error: "Caption metadata unavailable." }));
    return true;
  }
  if (message.type === "YOUTUBE_SUBTITLES_GET") {
    const videoId = new URL(location.href).searchParams.get("v");
    if (location.pathname !== "/watch" || videoId !== message.videoId) {
      respond({
        ok: false,
        error: "The active YouTube video changed. Retry on the current watch tab.",
      });
      return;
    }
    void requestYouTubeCaptions(message.videoId, message.language)
      .then(result => {
        if (result.bridgeVersion !== "native-caption-capture-v2") {
          respond({
            ok: false,
            error:
              "The YouTube page has an outdated caption reader. Rebuild the extension and reload this video tab before retrying.",
          });
          return;
        }
        respond(
          result.ok &&
            result.text &&
            result.text.length <= 3_000_000 &&
            typeof result.language === "string"
            ? { ok: true, text: result.text, language: result.language }
            : {
                ok: false,
                error: result.error ?? "YouTube did not return readable subtitles.",
                ...(isVideoCommandErrorCode(result.errorCode)
                  ? { errorCode: result.errorCode }
                  : {}),
              },
        );
      })
      .catch(error => {
        respond({
          ok: false,
          error: error instanceof Error ? error.message : "YouTube subtitles are unavailable.",
        });
      });
    return true;
  }
  if (message.type === "YOUTUBE_SEEK") {
    if (!Number.isInteger(message.timeMs) || message.timeMs < 0 || message.timeMs > 43_200_000) {
      respond({ ok: false, error: "Invalid video timestamp." });
      return;
    }
    const video =
      document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
      document.querySelector<HTMLVideoElement>("video");
    if (!video) {
      respond({ ok: false, error: "YouTube player is not ready. Start the video and retry." });
      return;
    }
    clearLoop();
    try {
      video.currentTime = message.timeMs / 1000;
      void video
        .play()
        .then(() => respond({ ok: true }))
        .catch(() =>
          respond({
            ok: false,
            error:
              "Video was positioned, but YouTube blocked playback. Press Play in the existing video tab.",
          }),
        );
    } catch {
      respond({ ok: false, error: "YouTube could not seek to the subtitle timestamp." });
    }
    return true;
  }
  if (message.type === "PLAYBACK_PLAY" || message.type === "PLAYBACK_PAUSE") {
    const video =
      document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
      document.querySelector<HTMLVideoElement>("video");
    if (!video) {
      respond({ ok: false, error: "The video player is not ready." });
      return;
    }
    clearLoop();
    if (message.type === "PLAYBACK_PAUSE") {
      video.pause();
      respond({ ok: true });
    } else
      void video
        .play()
        .then(() => respond({ ok: true }))
        .catch(() =>
          respond({ ok: false, error: "YouTube blocked playback. Press Play in the video tab." }),
        );
    return true;
  }
  if (message.type === "PLAYBACK_STATUS_GET") {
    const video =
      document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
      document.querySelector<HTMLVideoElement>("video");
    if (!video || !Number.isFinite(video.currentTime)) {
      respond({ ok: false, error: "The video player is not ready." });
    } else {
      respond({
        ok: true,
        currentMs: Math.round(video.currentTime * 1000),
        ...(Number.isFinite(video.duration)
          ? { durationMs: Math.round(video.duration * 1000) }
          : {}),
        playing: !video.paused && !video.ended,
      });
    }
    return;
  }
  if (message.type === "PLAYBACK_RATE_SET") {
    const video =
      document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
      document.querySelector<HTMLVideoElement>("video");
    if (!video) {
      respond({ ok: false, error: "YouTube player is not available." });
      return;
    }
    if (!Number.isFinite(message.rate) || message.rate < 0.5 || message.rate > 2) {
      respond({ ok: false, error: "Playback speed must be between 0.5× and 2×." });
      return;
    }
    try {
      video.playbackRate = message.rate;
      if (Math.abs(video.playbackRate - message.rate) > 0.01) {
        respond({ ok: false, error: "YouTube did not accept this playback speed." });
      } else {
        respond({ ok: true, rate: video.playbackRate });
      }
    } catch {
      respond({ ok: false, error: "YouTube could not change playback speed." });
    }
    return;
  }
  if (message.type === "LOOP_CLEAR") {
    clearLoop();
    respond({ ok: true });
    return;
  }
  if (message.type !== "LOOP_SET") return;
  const video =
    document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
    document.querySelector<HTMLVideoElement>("video");
  if (!video) {
    respond({ ok: false, error: "No YouTube video player is available in this tab." });
    return;
  }
  if (
    (message.resumeMs !== undefined &&
      (!Number.isInteger(message.resumeMs) ||
        message.resumeMs < message.startMs ||
        message.resumeMs >= message.endMs)) ||
    !Number.isFinite(message.startMs) ||
    !Number.isFinite(message.endMs) ||
    message.startMs < 0 ||
    message.endMs <= message.startMs ||
    message.endMs - message.startMs > 600000 ||
    ![0, 1, 2, 3].includes(message.delaySeconds) ||
    !(
      message.repeats === "infinite" ||
      (Number.isInteger(message.repeats) && message.repeats >= 1 && message.repeats <= 20)
    )
  ) {
    respond({ ok: false, error: "Invalid loop range or repeat setting." });
    return;
  }
  clearLoop();
  active = {
    video,
    start: message.startMs / 1000,
    end: message.endMs / 1000,
    repeats: message.repeats,
    delayMs: message.delaySeconds * 1000,
    completed: 0,
  };
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("pause", onPause);
  video.addEventListener("seeking", onSeeking);
  seek(video, (message.resumeMs ?? message.startMs) / 1000);
  void video.play().catch(() => clearLoop());
  respond({ ok: true });
});
