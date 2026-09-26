import type { LearningLanguage } from "@immersive/core";

export type PlaybackCapability = "timestampLink" | "diagnose" | "seek" | "loop" | "playbackRate";

export type LoopSettings = {
  startMs: number;
  endMs: number;
  repeats: number | "infinite";
  delaySeconds: number;
};

export type PlaybackStatus = { currentMs?: number; message: string };

export interface VideoAdapter {
  readonly id: string;
  readonly label: string;
  /** Strictly match an actual supported video URL, never an arbitrary domain suffix. */
  getVideoId(url: string | undefined): string | null;
  timestampLink?(url: string, startMs: number): string | null;
  diagnose?(url: string): Promise<PlaybackStatus>;
  /** Read-only current playback state for the optional companion view. */
  status?(url: string): Promise<{ currentMs?: number; playing?: boolean }>;
  seek?(url: string, startMs: number): Promise<void>;
  setPlaybackRate?(url: string, rate: number): Promise<void>;
  fetchSubtitles?(url: string, language: LearningLanguage): Promise<{ text: string; language: string }>;
  loop?(url: string, options: LoopSettings): Promise<void>;
  stopLoop?(url: string): Promise<void>;
}

export function supports(adapter: VideoAdapter, capability: PlaybackCapability): boolean {
  switch (capability) {
    case "timestampLink": return typeof adapter.timestampLink === "function";
    case "diagnose": return typeof adapter.diagnose === "function";
    case "seek": return typeof adapter.seek === "function";
    case "loop": return typeof adapter.loop === "function";
    case "playbackRate": return typeof adapter.setPlaybackRate === "function";
  }
}
