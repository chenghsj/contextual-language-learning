import { youtubeTimeLink } from "@immersive/core";
import { sendToVideo } from "./tab";
import type { VideoAdapter } from "./types";

const videoId = (url: string | undefined): string | null =>
  youtubeTimeLink(url, 0)?.match(/[?&]v=([A-Za-z0-9_-]{11})&/)?.[1] ?? null;

export const youtubeAdapter: VideoAdapter = {
  id: "youtube",
  label: "YouTube",
  getVideoId: videoId,
  timestampLink: (url, ms) => youtubeTimeLink(url, ms),
  async loop(url, options) {
    await sendToVideo(youtubeAdapter, url, { type: "LOOP_SET", ...options }, true);
  },
  async stopLoop(url) {
    await sendToVideo(youtubeAdapter, url, { type: "LOOP_CLEAR" });
  },
};
