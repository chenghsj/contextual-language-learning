import type { LearningLanguage } from "@contextual/core";

export type PlaybackCapability = "timestampLink" | "diagnose" | "seek" | "loop" | "playbackRate";

export type LoopSettings = {
  startMs: number;
  endMs: number;
  repeats: number | "infinite";
  delaySeconds: number;
  /** Resume once inside the range; subsequent repeats still begin at startMs. */
  resumeMs?: number;
};

export type PlaybackStatus = { currentMs?: number; message: string };
/** Track metadata contains no caption URLs, tokens or transcript payload. */
export type SubtitleTrackAvailability = {
  status: "available" | "unknown";
  tracks: { language: string; kind: "manual" | "auto" | "translated" }[];
};

export interface VideoAdapter {
  readonly id: string;
  readonly label: string;
  /** Strictly match an actual supported video URL, never an arbitrary domain suffix. */
  getVideoId(url: string | undefined): string | null;
  timestampLink?(url: string, startMs: number): string | null;
  diagnose?(url: string): Promise<PlaybackStatus>;
  /** Read-only current playback state for the optional companion view. */
  status?(url: string): Promise<{ currentMs?: number; durationMs?: number; playing?: boolean }>;
  seek?(url: string, startMs: number): Promise<void>;
  /** Unbounded transport for timing inspection. */
  play?(url: string): Promise<void>;
  pause?(url: string): Promise<void>;
  setPlaybackRate?(url: string, rate: number): Promise<void>;
  fetchSubtitles?(
    url: string,
    language: LearningLanguage,
  ): Promise<{ text: string; language: string }>;
  availableSubtitleTracks?(url: string): Promise<SubtitleTrackAvailability>;
  loop?(url: string, options: LoopSettings): Promise<void>;
  stopLoop?(url: string): Promise<void>;
}

export function supports(adapter: VideoAdapter, capability: PlaybackCapability): boolean {
  switch (capability) {
    case "timestampLink":
      return typeof adapter.timestampLink === "function";
    case "diagnose":
      return typeof adapter.diagnose === "function";
    case "seek":
      return typeof adapter.seek === "function";
    case "loop":
      return typeof adapter.loop === "function";
    case "playbackRate":
      return typeof adapter.setPlaybackRate === "function";
  }
}
