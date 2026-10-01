import { LEARNING_LANGUAGES, parseSubtitles } from "@immersive/core";
import {
  MAX_SUBTITLE_BYTES,
  normalizeNetflixTimedText,
  normalizedVttCues,
  subtitleUrlFromTrack,
  type SubtitleDocument,
} from "./netflix-subtitles";

/** Optional, undocumented Netflix interfaces: never assume their presence. */
export type NetflixCaptionTrack = {
  id?: string;
  trackId?: string;
  new_track_id?: string;
  bcp47?: string;
  language?: string;
  isNoneTrack?: boolean;
  isForcedNarrative?: boolean;
  ttDownloadables?: unknown;
  [key: string]: unknown;
};

export type NetflixCaptionPlayer = {
  getTextTrackList?(): NetflixCaptionTrack[];
  getTimedTextTrackList?(): NetflixCaptionTrack[];
  getTextTrack?(): NetflixCaptionTrack | null;
  getTimedTextTrack?(): NetflixCaptionTrack | null;
  setTextTrack?(track: NetflixCaptionTrack): void;
  setTimedTextTrack?(track: NetflixCaptionTrack): void;
};

type Options = {
  fetchDocument?: typeof fetch;
  pause?: (ms: number) => Promise<void>;
  sameVideo?: () => boolean;
};

function trackId(track: NetflixCaptionTrack | null): string | null {
  return track?.trackId ?? track?.new_track_id ?? track?.id ?? null;
}

function languageMatches(trackLanguage: string | undefined, requested: string): boolean {
  const language = (trackLanguage ?? "").toLowerCase();
  const preferred = requested.toLowerCase();
  return language === preferred || language.startsWith(preferred + "-");
}

function findInternalTrackUrl(root: unknown, wantedId: string): string | null {
  const visited = new WeakSet<object>();
  let checked = 0;
  function walk(value: unknown, depth: number): string | null {
    if (
      !value ||
      typeof value !== "object" ||
      visited.has(value) ||
      depth > 14 ||
      ++checked > 30_000
    )
      return null;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (
          entry &&
          typeof entry === "object" &&
          trackId(entry as NetflixCaptionTrack) === wantedId
        ) {
          const url = subtitleUrlFromTrack(entry);
          if (url) return url;
        }
      }
      for (const entry of value) {
        const result = walk(entry, depth + 1);
        if (result) return result;
      }
      return null;
    }
    // Inspect only own data properties: do not invoke arbitrary Netflix getters.
    let descriptors: PropertyDescriptorMap;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return null;
    }
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (
        ["parentNode", "ownerDocument", "window", "document"].includes(name) ||
        !("value" in descriptor)
      )
        continue;
      const result = walk(descriptor.value, depth + 1);
      if (result) return result;
    }
    return null;
  }
  return walk(root, 0);
}

function browserTextTrack(
  video: HTMLVideoElement | null,
  requested: string,
): SubtitleDocument | null {
  if (!video) return null;
  const tracks = Array.from(video.textTracks);
  const selected =
    tracks.find(track => languageMatches(track.language, requested) && track.mode === "showing") ??
    tracks.find(track => languageMatches(track.language, requested));
  if (!selected?.cues?.length) return null;
  const cues = Array.from(selected.cues).map(cue => {
    const text =
      typeof VTTCue !== "undefined" && cue instanceof VTTCue
        ? cue.text
        : ((cue as VTTCue).text ?? "");
    return { startMs: cue.startTime * 1000, endMs: cue.endTime * 1000, text };
  });
  const duration = video.duration * 1000;
  // HTML textTracks on Netflix may expose only currently displayed cues. A
  // cue near the end is not evidence that the entire transcript is available.
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (
    duration > 60_000 &&
    (cues.length < 3 ||
      Math.min(...cues.map(cue => cue.startMs)) > duration * 0.3 ||
      Math.max(...cues.map(cue => cue.endMs)) < duration * 0.7)
  )
    return null;
  return { text: normalizedVttCues(cues), language: selected.language };
}

/** Only the current user's selected watch session is examined; no DRM or media access. */
export async function readNetflixSubtitles(
  player: NetflixCaptionPlayer,
  video: HTMLVideoElement | null,
  sessionRoot: () => unknown,
  requestedLanguage: string,
  options: Options = {},
): Promise<SubtitleDocument> {
  if (!LEARNING_LANGUAGES.some(language => language === requestedLanguage)) {
    throw new Error("Unsupported learning language.");
  }
  const sameVideo = options.sameVideo ?? (() => true);
  if (!sameVideo()) throw new Error("The Netflix watch page changed. Try again.");
  // The active Netflix build may expose either generation of the text-track API.
  let timedTracks: NetflixCaptionTrack[] = [];
  let textTracks: NetflixCaptionTrack[] = [];
  try {
    timedTracks = player.getTimedTextTrackList?.() ?? [];
  } catch {
    /* unavailable */
  }
  try {
    textTracks = player.getTextTrackList?.() ?? [];
  } catch {
    /* unavailable */
  }
  let tracks = [...timedTracks, ...textTracks];
  // Netflix can expose the HTML video before its internal subtitle catalog.
  // Wait briefly only for an actual playing/loading video; never fabricate tracks.
  if (!tracks.length && video) {
    const pause = options.pause ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < 4 && !tracks.length; attempt++) {
      if (!sameVideo()) throw new Error("The Netflix watch page changed. Try again.");
      await pause(300);
      try {
        timedTracks = player.getTimedTextTrackList?.() ?? [];
      } catch {
        timedTracks = [];
      }
      try {
        textTracks = player.getTextTrackList?.() ?? [];
      } catch {
        textTracks = [];
      }
      tracks = [...timedTracks, ...textTracks];
    }
  }
  const candidates = tracks.filter(
    track =>
      !track.isNoneTrack &&
      !track.isForcedNarrative &&
      [track.bcp47, track.language].some(language => languageMatches(language, requestedLanguage)),
  );
  const chosen = candidates.find(track => subtitleUrlFromTrack(track)) ?? candidates[0];
  if (!chosen) {
    const native = browserTextTrack(video, requestedLanguage);
    if (native) return native;
    throw new Error(
      tracks.length
        ? "Netflix has subtitle tracks, but none match the selected learning language. Choose an available subtitle language and retry."
        : "Netflix player has not exposed subtitle tracks. Start playback, enable subtitles, then retry.",
    );
  }
  const id = trackId(chosen);
  let original: NetflixCaptionTrack | null = null;
  try {
    original = player.getTextTrack?.() ?? null;
  } catch {
    /* Not supported on every Netflix build. */
  }
  if (!original) {
    try {
      original = player.getTimedTextTrack?.() ?? null;
    } catch {
      /* Not supported on every Netflix build. */
    }
  }
  const previous = original ?? tracks.find(track => track.isNoneTrack) ?? null;
  const selectTrack = (track: NetflixCaptionTrack): boolean => {
    if (player.setTextTrack) {
      try {
        player.setTextTrack(track);
        return true;
      } catch {
        /* Fall back to the older timed-text method. */
      }
    }
    if (player.setTimedTextTrack) {
      player.setTimedTextTrack(track);
      return true;
    }
    return false;
  };
  let changed = false;
  try {
    let url = subtitleUrlFromTrack(chosen) ?? (id ? findInternalTrackUrl(sessionRoot(), id) : null);
    if (!url && id && previous && trackId(previous) !== id) {
      // Change languages only after a user click; restore the original track.
      changed = selectTrack(chosen);
    }
    const pause = options.pause ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    for (let attempt = 0; !url && id && attempt < 12; attempt++) {
      if (!sameVideo()) throw new Error("The Netflix watch page changed. Try again.");
      await pause(250);
      url = subtitleUrlFromTrack(chosen) ?? findInternalTrackUrl(sessionRoot(), id);
    }
    if (!url) {
      const native = browserTextTrack(video, requestedLanguage);
      if (native) return native;
      throw new Error(
        "Netflix did not expose a readable subtitle document for this video. Enable subtitles, refresh the watch tab and try again.",
      );
    }
    // The URL has already passed the extractor's allowlist. Avoid a second
    // page-world URL check that can disagree with track selection. The isolated
    // relay and extension service worker independently validate every request.
    const request = options.fetchDocument ?? fetch;
    const response = await request(url, {
      credentials: "include",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error("Netflix subtitle request failed (HTTP " + response.status + ").");
    if (Number(response.headers.get("content-length") ?? 0) > MAX_SUBTITLE_BYTES) {
      throw new Error("Netflix subtitle document exceeds the size limit.");
    }
    const body = await response.text();
    if (!sameVideo()) throw new Error("The Netflix watch page changed. Try again.");
    const normalized = normalizeNetflixTimedText(body);
    if (!parseSubtitles(normalized).length) {
      throw new Error(
        "Netflix delivered a subtitle document, but it contains no usable timed cues. Try another subtitle track or import a caption file.",
      );
    }
    return { text: normalized, language: chosen.bcp47 ?? chosen.language ?? requestedLanguage };
  } finally {
    if (changed && previous) {
      try {
        selectTrack(previous);
      } catch {
        /* Preserve successful transcript even when the player changes while loading. */
      }
    }
  }
}
