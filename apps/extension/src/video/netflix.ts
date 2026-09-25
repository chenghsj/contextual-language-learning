import { netflixWatchId } from "@immersive/core";
import { sendToVideo } from "./tab";
import type { VideoAdapter } from "./types";

export const netflixAdapter: VideoAdapter = {
  id: "netflix",
  label: "Netflix",
  getVideoId: netflixWatchId,
  async diagnose(url) {
    const result = await sendToVideo<{ ok: boolean; error?: string; currentMs?: number }>(
      netflixAdapter, url, { type: "NETFLIX_DIAGNOSE" },
    );
    return { currentMs: result.currentMs, message: "播放器已就緒" };
  },
  async seek(url, startMs) {
    await sendToVideo(netflixAdapter, url, { type: "NETFLIX_SEEK", timeMs: startMs }, true);
  },
  async loop(url, options) {
    await sendToVideo(netflixAdapter, url, { type: "NETFLIX_LOOP_SET", ...options }, true);
  },
  async stopLoop(url) {
    await sendToVideo(netflixAdapter, url, { type: "NETFLIX_LOOP_CLEAR" });
  },
};
