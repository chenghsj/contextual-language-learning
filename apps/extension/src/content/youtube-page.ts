import { CaptionRetrievalError } from "../video/command-errors";
import { LEARNING_LANGUAGES } from "@contextual/core";
import {
  allowedYouTubeCaptionUrl,
  chooseYouTubeCaptionTrack,
  observedYouTubeCaptionUrls,
  parsePlayerYouTubeCaptionResponse,
  readYouTubeCaptionTracks,
  youtubeTimedTextToVtt,
  youtubeCaptionCandidates,
  YOUTUBE_CAPTION_FETCH_BUDGET_MS,
  YOUTUBE_CAPTION_FETCH_ATTEMPT_MS,
} from "../video/youtube-captions";

// MAIN world: access only the active watch player's public caption-track metadata.
// Runs a caption request only when the Side Panel explicitly asks for it.
(() => {
  const REQUEST = "contextual-learning:youtube:caption-request";
  const RESPONSE = "contextual-learning:youtube:caption-response";
  const TRACK_REQUEST = "contextual-learning:youtube:track-request";
  const TRACK_RESPONSE = "contextual-learning:youtube:track-response";
  const BRIDGE_VERSION = "native-caption-capture-v4";
  const HEALTH_REQUEST = "contextual-learning:youtube:bridge-health-request";
  const HEALTH_RESPONSE = "contextual-learning:youtube:bridge-health-response";
  class MissingYouTubeCaptionTrackError extends CaptionRetrievalError {
    constructor(message: string) {
      super(message, "TRACK_UNAVAILABLE");
    }
  }
  type CaptionRequest = {
    source: "contextual-learning";
    id: string;
    videoId: string;
    language: string;
  };
  type PlayerElement = HTMLElement & { getPlayerResponse?: () => unknown };
  type Page = typeof window & {
    ytInitialPlayerResponse?: unknown;
    __contextualYouTubeCaptions?: boolean;
  };
  const page = window as Page;
  if (page.__contextualYouTubeCaptions) return;
  page.__contextualYouTubeCaptions = true;

  // Return immediately before any transcript fetch, even while the player loads.
  window.addEventListener(HEALTH_REQUEST, event => {
    const request = (event as CustomEvent<{ source?: string; id?: string }>).detail;
    if (
      request?.source !== "contextual-learning" ||
      typeof request.id !== "string" ||
      request.id.length > 100
    )
      return;
    window.dispatchEvent(
      new CustomEvent(HEALTH_RESPONSE, {
        detail: { source: "contextual-learning", id: request.id, bridgeVersion: BRIDGE_VERSION },
      }),
    );
  });

  function currentVideoId(): string | null {
    if (
      !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(location.hostname) ||
      location.pathname !== "/watch"
    )
      return null;
    const id = new URL(location.href).searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  // A signed track baseUrl can return HTTP 200 with an empty body. Install
  // before the player starts, then retain only the readable body of an actual
  // YouTube caption request. No token, URL or transcript is sent anywhere.
  type Captured = NonNullable<ReturnType<typeof parsePlayerYouTubeCaptionResponse>>;
  const captured = new Map<string, Captured>();
  const MAX_CAPTURE = 3_000_000;
  let captionRetryAfter = 0;

  function pauseCaptionRequests(retryAfter: string | null): void {
    const seconds = Number(retryAfter);
    const requestedUntil =
      Number.isFinite(seconds) && seconds > 0
        ? Date.now() + seconds * 1000
        : Date.parse(retryAfter ?? "");
    captionRetryAfter = Math.max(
      captionRetryAfter,
      Date.now() + 60_000,
      Number.isFinite(requestedUntil) ? requestedUntil : 0,
    );
  }

  function rateLimitedError(): CaptionRetrievalError {
    return new CaptionRetrievalError(
      "YouTube is rate limiting subtitle requests (HTTP 429). Wait before retrying.",
      "CAPTION_RATE_LIMITED",
    );
  }

  function requestVideoId(raw: string): string | null {
    const videoId = currentVideoId();
    if (!videoId) return null;
    try {
      const url = allowedYouTubeCaptionUrl(new URL(raw, location.href).toString(), videoId);
      return url.searchParams.get("v") === videoId ? videoId : null;
    } catch {
      return null;
    }
  }

  function rememberCaption(raw: string, body: string, requestVideo: string): void {
    if (currentVideoId() !== requestVideo || !body.trim() || body.length > MAX_CAPTURE) return;
    const entry = parsePlayerYouTubeCaptionResponse(raw, body, requestVideo);
    if (!entry) return;
    const key =
      requestVideo +
      ":" +
      entry.language +
      ":" +
      entry.kind +
      ":" +
      (entry.sourceLanguageCode ?? "");
    captured.delete(key);
    captured.set(key, entry);
    while (captured.size > 8) {
      const oldest = captured.keys().next().value;
      if (!oldest) break;
      captured.delete(oldest);
    }
  }

  function fromPlayer(
    videoId: string,
    language: string,
    kind: string | undefined,
    sourceLanguageCode?: string,
  ): Captured | null {
    const wanted = language.toLowerCase();
    const preferred = kind === "asr" ? "asr" : "manual";
    const source = sourceLanguageCode?.toLowerCase();
    const exact = captured.get(videoId + ":" + wanted + ":" + preferred + ":" + (source ?? ""));
    if (exact) return exact;
    const matching = Array.from(captured.values()).filter(
      entry =>
        entry.videoId === videoId &&
        entry.sourceLanguageCode === source &&
        (entry.language === wanted || entry.language.startsWith(wanted + "-")),
    );
    return (
      matching.find(entry => entry.kind === preferred) ??
      (kind === undefined && matching.length === 1 ? matching[0] : null)
    );
  }

  const nativeFetch = window.fetch;
  window.fetch = function (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    const input = args[0];
    let address = "";
    try {
      address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    } catch {
      /* Pass unknown request forms through untouched. */
    }
    const videoId = address ? requestVideoId(address) : null;
    return nativeFetch.apply(window, args).then(response => {
      if (videoId && response.status === 429) {
        pauseCaptionRequests(response.headers.get("retry-after"));
      }
      if (
        videoId &&
        response.ok &&
        Number(response.headers.get("content-length") ?? 0) <= MAX_CAPTURE
      ) {
        void response
          .clone()
          .text()
          .then(body => rememberCaption(address, body, videoId))
          .catch(() => {
            /* Never affect playback if a clone cannot be read. */
          });
      }
      return response;
    });
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async: boolean = true,
    username?: string,
    password?: string,
  ): void {
    const address = String(url);
    const videoId = method.toUpperCase() === "GET" ? requestVideoId(address) : null;
    if (videoId) {
      this.addEventListener(
        "load",
        () => {
          if (this.status === 429) {
            pauseCaptionRequests(this.getResponseHeader("retry-after"));
            return;
          }
          if (this.status !== 200) return;
          try {
            const body =
              this.responseType === "" || this.responseType === "text"
                ? this.responseText
                : this.responseType === "json"
                  ? JSON.stringify(this.response)
                  : "";
            if (body && body.length <= MAX_CAPTURE) rememberCaption(address, body, videoId);
          } catch {
            /* Ignore unsupported response types. */
          }
        },
        { once: true },
      );
    }
    nativeOpen.call(this, method, url, async, username, password);
  };

  function tracksForVideo(videoId: string) {
    const player = document.getElementById("movie_player") as PlayerElement | null;
    let response: unknown;
    try {
      response = player?.getPlayerResponse?.();
    } catch {
      /* player still loading */
    }
    const current = readYouTubeCaptionTracks(response, videoId);
    return current.length
      ? current
      : readYouTubeCaptionTracks(page.ytInitialPlayerResponse, videoId);
  }

  async function getCurrentCaptions(
    request: CaptionRequest,
  ): Promise<{ text: string; language: string }> {
    if (currentVideoId() !== request.videoId)
      throw new CaptionRetrievalError("The YouTube video changed. Try again.", "VIDEO_CHANGED");
    if (!LEARNING_LANGUAGES.some(language => language === request.language)) {
      throw new Error("Unsupported learning language.");
    }
    let tracks = tracksForVideo(request.videoId);
    // The watch URL can become active before its player has loaded caption metadata.
    for (let attempt = 0; !tracks.length && attempt < 8; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, 250));
      if (currentVideoId() !== request.videoId)
        throw new CaptionRetrievalError("The YouTube video changed. Try again.", "VIDEO_CHANGED");
      tracks = tracksForVideo(request.videoId);
    }
    if (!tracks.length) {
      throw new Error(
        "YouTube has not exposed subtitle tracks for this video. Wait for the player, then retry.",
      );
    }
    const track = chooseYouTubeCaptionTrack(tracks, request.language);
    if (!track) {
      throw new MissingYouTubeCaptionTrackError(
        "This YouTube video has no available " +
          request.language +
          " subtitle track. Choose a language provided by the video.",
      );
    }
    const playerCaptions = fromPlayer(
      request.videoId,
      track.languageCode,
      track.kind,
      track.sourceLanguageCode,
    );
    if (playerCaptions) return { text: playerCaptions.text, language: playerCaptions.language };
    if (Date.now() < captionRetryAfter) throw rateLimitedError();
    const originalUrl = allowedYouTubeCaptionUrl(track.baseUrl, request.videoId);
    const json3Url = new URL(originalUrl);
    json3Url.searchParams.set("fmt", "json3");
    // Do not assume every player accepts an added fmt parameter. Retry the exact
    // player-provided URL if JSON3 is unavailable; it may return WEBVTT or XML.
    // The player's own session request can include parameters missing from the
    // caption track's baseUrl. Use only resources already loaded on this page.
    const observed = observedYouTubeCaptionUrls(
      performance.getEntriesByType("resource").map(entry => entry.name),
      request.videoId,
      track.languageCode,
      track.sourceLanguageCode,
    );
    const candidates = youtubeCaptionCandidates(
      observed,
      json3Url.toString(),
      originalUrl.toString(),
    );
    const deadline = Date.now() + YOUTUBE_CAPTION_FETCH_BUDGET_MS;
    let lastError: Error | null = null;
    let emptyResponses = 0;
    let deadlineExpired = false;
    for (const candidate of candidates) {
      if (currentVideoId() !== request.videoId)
        throw new CaptionRetrievalError("The YouTube video changed. Try again.", "VIDEO_CHANGED");
      if (Date.now() < captionRetryAfter) throw rateLimitedError();
      const remainingMs = deadline - Date.now();
      if (remainingMs < 250) {
        deadlineExpired = true;
        break;
      }
      try {
        const response = await fetch(candidate, {
          credentials: "include",
          signal: AbortSignal.timeout(Math.min(YOUTUBE_CAPTION_FETCH_ATTEMPT_MS, remainingMs)),
        });
        if (response.status === 429) throw rateLimitedError();
        if (!response.ok)
          throw new Error("YouTube subtitle request failed (HTTP " + response.status + ").");
        if (response.url) allowedYouTubeCaptionUrl(response.url, request.videoId);
        if (Number(response.headers.get("content-length") ?? 0) > 3_000_000) {
          throw new CaptionRetrievalError(
            "YouTube subtitle document exceeds the size limit.",
            "CAPTION_TOO_LARGE",
          );
        }
        const body = await response.text();
        if (currentVideoId() !== request.videoId)
          throw new CaptionRetrievalError("The YouTube video changed. Try again.", "VIDEO_CHANGED");
        if (body.length > 3_000_000)
          throw new CaptionRetrievalError(
            "YouTube subtitle document exceeds the size limit.",
            "CAPTION_TOO_LARGE",
          );
        if (!body.trim()) {
          emptyResponses++;
          throw new Error(
            "YouTube returned an empty subtitle response (HTTP " + response.status + ").",
          );
        }
        if (/^\s*(?:<!doctype html|<html\b)/i.test(body)) {
          throw new Error(
            "YouTube returned HTML instead of a subtitle document (HTTP " + response.status + ").",
          );
        }
        const text = youtubeTimedTextToVtt(body);
        if (text.length > 3_000_000)
          throw new CaptionRetrievalError(
            "YouTube subtitles exceed the size limit.",
            "CAPTION_TOO_LARGE",
          );
        return { text, language: track.languageCode };
      } catch (error) {
        if (currentVideoId() !== request.videoId)
          throw new CaptionRetrievalError("The YouTube video changed. Try again.", "VIDEO_CHANGED");
        // A real caption response may arrive through the player's fetch/XHR
        // while one of our fallback URLs fails or returns an empty body.
        const playerCaptions = fromPlayer(
          request.videoId,
          track.languageCode,
          track.kind,
          track.sourceLanguageCode,
        );
        if (playerCaptions) return { text: playerCaptions.text, language: playerCaptions.language };
        if (error instanceof CaptionRetrievalError && error.code === "CAPTION_RATE_LIMITED") {
          throw error;
        }
        lastError =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
            ? new CaptionRetrievalError(
                "A YouTube subtitle request timed out. Enable CC, play the video and retry.",
                "CAPTION_TIMEOUT",
              )
            : error instanceof Error
              ? error
              : new Error("YouTube subtitle request failed.");
      }
    }
    // The player's cloned response may finish after our fallback requests.
    for (let attempt = 0; attempt < 4; attempt++) {
      const playerCaptions = fromPlayer(
        request.videoId,
        track.languageCode,
        track.kind,
        track.sourceLanguageCode,
      );
      if (playerCaptions) return { text: playerCaptions.text, language: playerCaptions.language };
      await new Promise<void>(resolve => setTimeout(resolve, 200));
      if (currentVideoId() !== request.videoId)
        throw new CaptionRetrievalError("The YouTube video changed. Try again.", "VIDEO_CHANGED");
    }
    if (emptyResponses === candidates.length) {
      throw new CaptionRetrievalError(
        "YouTube returned empty subtitle responses (HTTP 200). " +
          "Some videos need the player's own session caption request. " +
          "Enable CC, play the video for a few seconds, then retry. " +
          "If it persists, this subtitle track is not readable in the current session.",
        "CAPTION_EMPTY",
      );
    }
    if (deadlineExpired || Date.now() >= deadline) {
      throw new CaptionRetrievalError(
        "YouTube subtitle retrieval timed out. Enable CC, play this video " +
          "for a few seconds and retry. If it persists, use manual subtitles.",
        "CAPTION_TIMEOUT",
      );
    }
    throw lastError ?? new Error("YouTube subtitles are unavailable.");
  }

  // Metadata-only: never expose player-provided signed URLs or caption text.
  window.addEventListener(TRACK_REQUEST, event => {
    const request = (event as CustomEvent<{ source?: string; id?: string; videoId?: string }>)
      .detail;
    if (
      request?.source !== "contextual-learning" ||
      typeof request.id !== "string" ||
      request.id.length > 100 ||
      typeof request.videoId !== "string"
    )
      return;
    void (async () => {
      if (currentVideoId() !== request.videoId) throw new Error("The YouTube video changed.");
      let tracks = tracksForVideo(request.videoId);
      for (let attempt = 0; !tracks.length && attempt < 8; attempt++) {
        await new Promise<void>(resolve => setTimeout(resolve, 250));
        if (currentVideoId() !== request.videoId) throw new Error("The YouTube video changed.");
        tracks = tracksForVideo(request.videoId);
      }
      return {
        status: tracks.length ? "available" : "unknown",
        tracks: tracks.map(track => ({
          language: track.languageCode,
          kind: track.sourceLanguageCode ? "translated" : track.kind === "asr" ? "auto" : "manual",
        })),
      };
    })()
      .then(result => {
        window.dispatchEvent(
          new CustomEvent(TRACK_RESPONSE, {
            detail: {
              source: "contextual-learning",
              id: request.id,
              bridgeVersion: BRIDGE_VERSION,
              ok: true,
              ...result,
            },
          }),
        );
      })
      .catch(error => {
        window.dispatchEvent(
          new CustomEvent(TRACK_RESPONSE, {
            detail: {
              source: "contextual-learning",
              id: request.id,
              bridgeVersion: BRIDGE_VERSION,
              ok: false,
              error: error instanceof Error ? error.message : "Caption tracks unavailable.",
            },
          }),
        );
      });
  });

  window.addEventListener(REQUEST, event => {
    const request = (event as CustomEvent<CaptionRequest>).detail;
    if (
      request?.source !== "contextual-learning" ||
      typeof request.id !== "string" ||
      request.id.length > 100 ||
      typeof request.videoId !== "string" ||
      typeof request.language !== "string"
    )
      return;
    void getCurrentCaptions(request)
      .then(result => {
        window.dispatchEvent(
          new CustomEvent(RESPONSE, {
            detail: {
              source: "contextual-learning",
              id: request.id,
              bridgeVersion: BRIDGE_VERSION,
              ok: true,
              ...result,
            },
          }),
        );
      })
      .catch(error => {
        window.dispatchEvent(
          new CustomEvent(RESPONSE, {
            detail: {
              source: "contextual-learning",
              id: request.id,
              bridgeVersion: BRIDGE_VERSION,
              ok: false,
              error: error instanceof Error ? error.message : "YouTube subtitles are unavailable.",
              ...(error instanceof CaptionRetrievalError
                ? { errorCode: error.code }
                : { errorCode: "CAPTION_FAILED" }),
            },
          }),
        );
      });
  });
})();
