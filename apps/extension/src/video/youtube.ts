import { youtubeTimeLink } from "@immersive/core";
import { sendToVideo } from "./tab";
import type { VideoAdapter } from "./types";

const videoIdFromUrl = (url: string | undefined): string | null =>
  youtubeTimeLink(url, 0)?.match(/[?&]v=([A-Za-z0-9_-]{11})&/)?.[1] ?? null;

export const youtubeAdapter: VideoAdapter = {
  id: "youtube",
  label: "YouTube",
  getVideoId: videoIdFromUrl,
  timestampLink: (url, ms) => youtubeTimeLink(url, ms),
  async status(url) {
    const result = await sendToVideo<{
      ok: boolean;
      error?: string;
      currentMs?: number;
      playing?: boolean;
    }>(youtubeAdapter, url, { type: "PLAYBACK_STATUS_GET" });
    return { currentMs: result.currentMs, playing: result.playing };
  },
  async seek(url, startMs) {
    await sendToVideo(youtubeAdapter, url, { type: "YOUTUBE_SEEK", timeMs: startMs }, true);
  },
  async availableSubtitleTracks(url) {
    const videoId = videoIdFromUrl(url);
    if (!videoId) throw new Error("Open a supported YouTube watch page first.");
    const result = await sendToVideo<{
      ok: boolean;
      error?: string;
      status?: "available" | "unknown";
      tracks?: { language: string; kind: "manual" | "auto" }[];
    }>(youtubeAdapter, url, { type: "YOUTUBE_CAPTION_TRACKS_GET", videoId });
    return {
      status: result.status === "available" ? ("available" as const) : ("unknown" as const),
      tracks: result.tracks ?? [],
    };
  },
  async fetchSubtitles(url, language) {
    const videoId = videoIdFromUrl(url);
    if (!videoId) throw new Error("Open a supported YouTube watch page first.");
    const result = await sendToVideo<{
      ok: boolean;
      error?: string;
      text?: string;
      language?: string;
    }>(youtubeAdapter, url, { type: "YOUTUBE_SUBTITLES_GET", videoId, language });
    if (!result.text || !result.language) throw new Error("YouTube did not return subtitle text.");
    return { text: result.text, language: result.language };
  },
  async setPlaybackRate(url, rate) {
    await sendToVideo(youtubeAdapter, url, { type: "PLAYBACK_RATE_SET", rate });
  },
  async loop(url, options) {
    await sendToVideo(youtubeAdapter, url, { type: "LOOP_SET", ...options }, true);
  },
  async play(url) {
    await sendToVideo(youtubeAdapter, url, { type: "PLAYBACK_PLAY" });
  },
  async pause(url) {
    await sendToVideo(youtubeAdapter, url, { type: "PLAYBACK_PAUSE" });
  },
  async stopLoop(url) {
    await sendToVideo(youtubeAdapter, url, { type: "LOOP_CLEAR" });
  },
};
