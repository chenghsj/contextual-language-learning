import { readNetflixSubtitles, type NetflixCaptionPlayer } from "../video/netflix-extract";

// MAIN-world playback bridge. Caption access happens only after a user action.
// Adapted to the minimal diagnostic and seek actions from netflix-shortcut-override.
// Netflix playerApp.getAPI() is an undocumented internal interface and may disappear.

(() => {
  const REQUEST_EVENT = "immersive-learning:netflix:request";
  const RESPONSE_EVENT = "immersive-learning:netflix:response";
  type Action = "diagnose" | "status" | "seekTo" | "pause" | "play" | "setPlaybackRate" | "subtitlesGet";
  type Request = { source: "immersive-learning"; id: string; action: Action; value?: number; language?: string };
  type Player = NetflixCaptionPlayer & { seek(ms: number): void; getCurrentTime(): number; pause(): void; play(): void };
  type PlayerApi = {
    getAllPlayerSessionIds(): string[];
    getVideoPlayerBySessionId(id: string): Player | null | undefined;
  };
  type Page = typeof window & {
    netflix?: { player?: { MediaSession?: unknown }; appContext?: { state?: { playerApp?: { getAPI(): { videoPlayer: PlayerApi } } } } };
    __immersiveLearningNetflixBridge?: boolean;
  };
  const page = window as Page;
  if (page.__immersiveLearningNetflixBridge) return;
  page.__immersiveLearningNetflixBridge = true;

  const findVideo = (): HTMLVideoElement | null => {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video"));
    return videos.reduce<HTMLVideoElement | null>((best, candidate) => {
      if (!best) return candidate;
      const playing = !candidate.paused && !candidate.ended;
      const bestPlaying = !best.paused && !best.ended;
      if (playing !== bestPlaying) return playing ? candidate : best;
      const rect = candidate.getBoundingClientRect();
      const bestRect = best.getBoundingClientRect();
      return rect.width * rect.height > bestRect.width * bestRect.height ? candidate : best;
    }, null);
  };

  const selectPlayer = (): { player: Player; sessionId: string; video: HTMLVideoElement | null } | null => {
    const api = page.netflix?.appContext?.state?.playerApp?.getAPI()?.videoPlayer;
    if (!api) return null;
    const ids = api.getAllPlayerSessionIds();
    const entries = ids.flatMap(sessionId => {
      const player = api.getVideoPlayerBySessionId(sessionId);
      return player ? [{ player, sessionId }] : [];
    });
    if (!entries.length) return null;
    const video = findVideo();
    if (!video || entries.length === 1 || !Number.isFinite(video.currentTime)) {
      return { ...entries[0], video };
    }
    // Netflix's internal player time is in milliseconds; HTMLVideoElement uses seconds.
    const referenceMs = video.currentTime * 1000;
    const ranked = entries.map(entry => {
      try {
        return { ...entry, delta: Math.abs(entry.player.getCurrentTime() - referenceMs) };
      } catch {
        return { ...entry, delta: Number.POSITIVE_INFINITY };
      }
    }).sort((a, b) => a.delta - b.delta);
    return { player: ranked[0].player, sessionId: ranked[0].sessionId, video };
  };

  const isRequest = (value: unknown): value is Request => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<Request>;
    return candidate.source === "immersive-learning"
      && typeof candidate.id === "string" && candidate.id.length < 100
      && ["diagnose", "status", "seekTo", "pause", "play", "setPlaybackRate", "subtitlesGet"].includes(candidate.action ?? "");
  };

  window.addEventListener(REQUEST_EVENT, (event: Event) => {
    const request = (event as CustomEvent<unknown>).detail;
    if (!isRequest(request)) return;
    if (request.action === "subtitlesGet") {
      const watchId = location.pathname.match(/^\/watch\/(\d+)/)?.[1];
      void (async () => {
        if (!watchId) throw new Error("Open a Netflix watch page first.");
        const chosen = selectPlayer();
        if (!chosen) throw new Error("Netflix playback session is not ready. Start the video and retry.");
        const subtitle = await readNetflixSubtitles(
          chosen.player, chosen.video, () => page.netflix?.player?.MediaSession,
          request.language ?? "", {
            sameVideo: () => location.pathname.match(/^\/watch\/(\d+)/)?.[1] === watchId,
          },
        );
        window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
          detail: { source: "immersive-learning", id: request.id, ok: true,
            available: true, text: subtitle.text, language: subtitle.language },
        }));
      })().catch(error => {
        window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
          detail: { source: "immersive-learning", id: request.id, ok: false,
            available: false, error: error instanceof Error ? error.message : "Netflix subtitles are unavailable." },
        }));
      });
      return;
    }
    const result: {
      source: "immersive-learning"; id: string; ok: boolean; available: boolean;
      currentMs?: number; playing?: boolean | null; sessionId?: string;
      seekCalled?: boolean; playbackRate?: number; error?: string;
    } = { source: "immersive-learning", id: request.id, ok: false, available: false };
    try {
      const chosen = selectPlayer();
      result.available = !!chosen;
      if (!chosen) throw new Error("Netflix playback session is not available.");
      result.sessionId = chosen.sessionId;
      if (request.action === "seekTo") {
        const ms = request.value;
        if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > 43_200_000) {
          throw new Error("Invalid seek position.");
        }
        chosen.player.seek(ms);
        result.seekCalled = true;
      } else if (request.action === "pause") {
        chosen.player.pause();
      } else if (request.action === "play") {
        chosen.player.play();
      } else if (request.action === "setPlaybackRate") {
        const rate = request.value;
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0.5 || rate > 2) {
          throw new Error("Invalid playback speed.");
        }
        if (!chosen.video) throw new Error("Netflix HTML video is unavailable for playback speed.");
        // Follow netflix-shortcut-override: use the active video for rate changes,
        // not an undocumented internal setPlaybackRate method that may not exist.
        chosen.video.playbackRate = rate;
        chosen.video.defaultPlaybackRate = rate;
        if (Math.abs(chosen.video.playbackRate - rate) > 0.01) {
          throw new Error("Netflix did not accept the requested playback speed.");
        }
        result.playbackRate = chosen.video.playbackRate;
      }
      if (request.action === "status" || request.action === "diagnose") {
        const currentMs = chosen.player.getCurrentTime();
        if (Number.isFinite(currentMs)) result.currentMs = currentMs;
        result.playing = chosen.video ? !chosen.video.paused && !chosen.video.ended : null;
      }
      result.ok = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : "Netflix player API is unavailable.";
    }
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: result }));
  });
})();
