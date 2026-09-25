import { netflixWatchId } from "@immersive/core";
import { sendToVideo } from "./tab";
import type { VideoAdapter } from "./types";

export const netflixAdapter: VideoAdapter = {
  id: "netflix",
  label: "Netflix",
  getVideoId: netflixWatchId,
  async fetchSubtitles(url, language) {
    const result = await sendToVideo<{
      ok: boolean; error?: string; text?: string; language?: string;
    }>(netflixAdapter, url, { type: "NETFLIX_SUBTITLES_GET", language });
    if (!result.text || !result.language) throw new Error("Netflix did not return subtitle text.");
    return { text: result.text, language: result.language };
  },
  async status(url) {
    const result = await sendToVideo<{ ok: boolean; error?: string; currentMs?: number; playing?: boolean }>(
      netflixAdapter, url, { type: "NETFLIX_DIAGNOSE" },
    );
    return { currentMs: result.currentMs, playing: result.playing };
  },
  async diagnose(url) {
    const result = await sendToVideo<{ ok: boolean; error?: string; currentMs?: number }>(
      netflixAdapter, url, { type: "NETFLIX_DIAGNOSE" },
    );
    return { currentMs: result.currentMs, message: "播放器已就緒" };
  },
  async seek(url, startMs) {
    await sendToVideo(netflixAdapter, url, { type: "NETFLIX_SEEK", timeMs: startMs }, true);
  },
  async setPlaybackRate(url, rate) {
    await sendToVideo(netflixAdapter, url, { type: "NETFLIX_PLAYBACK_RATE_SET", rate });
  },
  async loop(url, options) {
    await sendToVideo(netflixAdapter, url, { type: "NETFLIX_LOOP_SET", ...options }, true);
  },
  async stopLoop(url) {
    await sendToVideo(netflixAdapter, url, { type: "NETFLIX_LOOP_CLEAR" });
  },
};
