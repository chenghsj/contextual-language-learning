import {
  allowedYouTubeCaptionUrl, chooseYouTubeCaptionTrack,
  observedYouTubeCaptionUrls, readYouTubeCaptionTracks, youtubeTimedTextToVtt,
} from "../video/youtube-captions";

// MAIN world: access only the active watch player's public caption-track metadata.
// Runs a caption request only when the Side Panel explicitly asks for it.
(() => {
  const REQUEST = "immersive-learning:youtube:caption-request";
  const RESPONSE = "immersive-learning:youtube:caption-response";
  type CaptionRequest = {
    source: "immersive-learning"; id: string; videoId: string; language: string;
  };
  type PlayerElement = HTMLElement & { getPlayerResponse?: () => unknown };
  type Page = typeof window & { ytInitialPlayerResponse?: unknown; __immersiveYouTubeCaptions?: boolean };
  const page = window as Page;
  if (page.__immersiveYouTubeCaptions) return;
  page.__immersiveYouTubeCaptions = true;

  function currentVideoId(): string | null {
    if (!["www.youtube.com", "youtube.com", "m.youtube.com"].includes(location.hostname) ||
      location.pathname !== "/watch") return null;
    const id = new URL(location.href).searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  }

  function tracksForVideo(videoId: string) {
    const player = document.getElementById("movie_player") as PlayerElement | null;
    let response: unknown;
    try { response = player?.getPlayerResponse?.(); } catch { /* player still loading */ }
    const current = readYouTubeCaptionTracks(response, videoId);
    return current.length ? current : readYouTubeCaptionTracks(page.ytInitialPlayerResponse, videoId);
  }

  async function getCurrentCaptions(request: CaptionRequest): Promise<{ text: string; language: string }> {
    if (currentVideoId() !== request.videoId) throw new Error("The YouTube video changed. Try again.");
    if (!["en", "ja", "ko"].includes(request.language)) {
      throw new Error("Choose an English, Japanese or Korean learning language.");
    }
    let tracks = tracksForVideo(request.videoId);
    // The watch URL can become active before its player has loaded caption metadata.
    for (let attempt = 0; !tracks.length && attempt < 8; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, 250));
      if (currentVideoId() !== request.videoId) throw new Error("The YouTube video changed. Try again.");
      tracks = tracksForVideo(request.videoId);
    }
    if (!tracks.length) {
      throw new Error("YouTube has not exposed subtitle tracks for this video. Wait for the player, then retry.");
    }
    const track = chooseYouTubeCaptionTrack(tracks, request.language);
    if (!track) {
      throw new Error("This YouTube video has no available " + request.language +
        " subtitle track. Choose a language provided by the video.");
    }
    const originalUrl = allowedYouTubeCaptionUrl(track.baseUrl, request.videoId);
    const json3Url = new URL(originalUrl);
    json3Url.searchParams.set("fmt", "json3");
    // Do not assume every player accepts an added fmt parameter. Retry the exact
    // player-provided URL if JSON3 is unavailable; it may return WEBVTT or XML.
    // The player's own session request can include parameters missing from the
    // caption track's baseUrl. Use only resources already loaded on this page.
    const observed = observedYouTubeCaptionUrls(
      performance.getEntriesByType("resource").map(entry => entry.name),
      request.videoId, track.languageCode,
    );
    const candidates = [...new Set([
      ...observed, json3Url.toString(), originalUrl.toString(),
    ])];
    let lastError: Error | null = null;
    let emptyResponses = 0;
    for (const candidate of candidates) {
      if (currentVideoId() !== request.videoId) throw new Error("The YouTube video changed. Try again.");
      try {
        const response = await fetch(candidate, {
          credentials: "include", signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) throw new Error("YouTube subtitle request failed (HTTP " + response.status + ").");
        if (response.url) allowedYouTubeCaptionUrl(response.url, request.videoId);
        if (Number(response.headers.get("content-length") ?? 0) > 3_000_000) {
          throw new Error("YouTube subtitle document exceeds the size limit.");
        }
        const body = await response.text();
        if (currentVideoId() !== request.videoId) throw new Error("The YouTube video changed. Try again.");
        if (body.length > 3_000_000) throw new Error("YouTube subtitle document exceeds the size limit.");
        if (!body.trim()) {
          emptyResponses++;
          throw new Error("YouTube returned an empty subtitle response (HTTP " + response.status + ").");
        }
        if (/^\s*(?:<!doctype html|<html\b)/i.test(body)) {
          throw new Error("YouTube returned HTML instead of a subtitle document (HTTP " + response.status + ").");
        }
        const text = youtubeTimedTextToVtt(body);
        if (text.length > 3_000_000) throw new Error("YouTube subtitles exceed the size limit.");
        return { text, language: track.languageCode };
      } catch (error) {
        if (currentVideoId() !== request.videoId) throw new Error("The YouTube video changed. Try again.");
        lastError = error instanceof Error ? error : new Error("YouTube subtitle request failed.");
      }
    }
    if (emptyResponses === candidates.length) {
      throw new Error("YouTube returned empty subtitle responses (HTTP 200). " +
        "Some videos need the player's own session caption request. " +
        "Enable CC, play the video for a few seconds, then retry. " +
        "If it persists, this subtitle track is not readable in the current session.");
    }
    throw lastError ?? new Error("YouTube subtitles are unavailable.");
  }

  window.addEventListener(REQUEST, event => {
    const request = (event as CustomEvent<CaptionRequest>).detail;
    if (request?.source !== "immersive-learning" ||
      typeof request.id !== "string" || request.id.length > 100 ||
      typeof request.videoId !== "string" || typeof request.language !== "string") return;
    void getCurrentCaptions(request).then(result => {
      window.dispatchEvent(new CustomEvent(RESPONSE, {
        detail: { source: "immersive-learning", id: request.id, ok: true, ...result },
      }));
    }).catch(error => {
      window.dispatchEvent(new CustomEvent(RESPONSE, {
        detail: { source: "immersive-learning", id: request.id, ok: false,
          error: error instanceof Error ? error.message : "YouTube subtitles are unavailable." },
      }));
    });
  });
})();
