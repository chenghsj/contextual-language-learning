import { netflixAdapter } from "./netflix";
import { youtubeAdapter } from "./youtube";
import type { VideoAdapter } from "./types";

export type { LoopSettings, PlaybackCapability, PlaybackStatus, VideoAdapter } from "./types";
export { supports } from "./types";

/** Fallback allows offline subtitle import with an optional source URL, without player access. */
const importAdapter: VideoAdapter = {
  id: "import",
  label: "字幕匯入（無播放器整合）",
  getVideoId: () => null,
};

// Register supported platforms here. Platform-specific commands live in their own adapters.
// Additional browser access/content scripts must also be declared in the Chrome manifest.
const videoAdapters: readonly VideoAdapter[] = [youtubeAdapter, netflixAdapter];

export function getVideoAdapter(url: string | undefined): VideoAdapter {
  return videoAdapters.find(adapter => adapter.getVideoId(url) !== null) ?? importAdapter;
}
