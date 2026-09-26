import { LEARNING_LANGUAGES, type LearningLanguage } from "@immersive/core";
import {
  NETFLIX_SEEK_GRACE_MS, NETFLIX_SEEK_TOLERANCE_MS, isManagedNetflixSeek,
  reachedNetflixSeekTarget, netflixLoopReachedEnd,
} from "../video/netflix-loop-timing";

// ISOLATED world: only handles user-initiated control requests from our Side Panel.
(() => {
  const REQUEST_EVENT = "immersive-learning:netflix:request";
  const RESPONSE_EVENT = "immersive-learning:netflix:response";
  const CAPTION_FETCH_REQUEST_EVENT = "immersive-learning:netflix:caption-fetch-request";
  const CAPTION_FETCH_RESPONSE_EVENT = "immersive-learning:netflix:caption-fetch-response";
  const pendingCaptionRequests = new Set<string>();
  const captionRequestsInFlight = new Set<string>();
  type Action = "diagnose" | "status" | "seekTo" | "pause" | "play" | "setPlaybackRate" | "subtitlesGet";
  type PageResponse = {
    source: "immersive-learning"; id: string; ok: boolean; available: boolean;
    bridgeVersion?: string;
    currentMs?: number; playing?: boolean | null; sessionId?: string;
    seekCalled?: boolean; playbackRate?: number; text?: string; language?: string; error?: string;
  };
  type Message =
    | { type: "VIDEO_METADATA_GET" }
    | { type: "NETFLIX_DIAGNOSE" }
    | { type: "NETFLIX_SEEK"; timeMs: number }
    | { type: "NETFLIX_LOOP_SET"; startMs: number; endMs: number; repeats: number | "infinite"; delaySeconds: number }
    | { type: "NETFLIX_LOOP_CLEAR" }
    | { type: "NETFLIX_PLAYBACK_RATE_SET"; rate: number }
    | { type: "NETFLIX_SUBTITLES_GET"; language: LearningLanguage };
  type Loop = {
    startMs: number; endMs: number; repeats: number | "infinite"; delayMs: number;
    count: number; busy: boolean; managedPause: boolean; expectedSeekUntil: number;
    expectedSeekTarget: number | null; playbackGraceUntil: number;
    pathname: string; video: HTMLVideoElement | null;
    interval: ReturnType<typeof setInterval> | null;
    timeout: ReturnType<typeof setTimeout> | null;
  };
  let current: Loop | null = null;

  function requestPage(action: Action, value?: number, language?: string): Promise<PageResponse> {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      if (action === "subtitlesGet") pendingCaptionRequests.add(id);
      const timer = setTimeout(() => {
        pendingCaptionRequests.delete(id);
        window.removeEventListener(RESPONSE_EVENT, onResponse);
        resolve({ source: "immersive-learning", id, ok: false, available: false, error: "Netflix page bridge did not respond." });
      }, action === "subtitlesGet" ? 16_000 : action === "status" ? 900 : 2_000);
      function onResponse(event: Event): void {
        const detail = (event as CustomEvent<PageResponse>).detail;
        if (detail?.source !== "immersive-learning" || detail.id !== id) return;
        clearTimeout(timer);
        pendingCaptionRequests.delete(id);
        window.removeEventListener(RESPONSE_EVENT, onResponse);
        resolve(detail);
      }
      window.addEventListener(RESPONSE_EVENT, onResponse);
      window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: { source: "immersive-learning", id, action, value, language },
      }));
    });
  }

  // The page world cannot use chrome.runtime. Relay only a caption URL tied to
  // an outstanding user-initiated subtitlesGet request to the extension worker.
  window.addEventListener(CAPTION_FETCH_REQUEST_EVENT, (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!detail || typeof detail !== "object") return;
    const request = detail as { source?: string; id?: string; url?: string };
    if (request.source !== "immersive-learning" || typeof request.id !== "string" ||
        !pendingCaptionRequests.has(request.id) || captionRequestsInFlight.has(request.id) ||
        typeof request.url !== "string") return;
    const id = request.id;
    const watchId = location.pathname.match(/^\/watch\/(\d+)(?:\/|$)/)?.[1];
    if (!watchId) {
      window.dispatchEvent(new CustomEvent(CAPTION_FETCH_RESPONSE_EVENT, {
        detail: { source: "immersive-learning", id, ok: false,
          error: "The Netflix watch page changed before its subtitle request. Retry on the video." },
      }));
      return;
    }
    captionRequestsInFlight.add(id);
    void chrome.runtime.sendMessage({
      type: "NETFLIX_CAPTION_DOCUMENT_FETCH", url: request.url, watchId,
    }).then((response: { ok: boolean; text?: string; error?: string } | undefined) => {
      if (!pendingCaptionRequests.has(id)) return;
      window.dispatchEvent(new CustomEvent(CAPTION_FETCH_RESPONSE_EVENT, {
        detail: { source: "immersive-learning", id, ok: response?.ok === true,
          text: response?.text, error: response?.error },
      }));
    }).catch(error => {
      if (!pendingCaptionRequests.has(id)) return;
      window.dispatchEvent(new CustomEvent(CAPTION_FETCH_RESPONSE_EVENT, {
        detail: { source: "immersive-learning", id, ok: false,
          error: error instanceof Error ? error.message : "Netflix caption request failed." },
      }));
    }).finally(() => { captionRequestsInFlight.delete(id); });
  });

  function findVideo(): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video"));
    return videos.find(video => !video.paused && !video.ended) ?? videos[0] ?? null;
  }

  function clearLoop(): void {
    if (!current) return;
    if (current.interval !== null) clearInterval(current.interval);
    if (current.timeout !== null) clearTimeout(current.timeout);
    current.video?.removeEventListener("pause", onPause);
    current.video?.removeEventListener("seeking", onSeeking);
    current.video?.removeEventListener("seeked", onSeeked);
    current = null;
  }

  function onPause(): void {
    const state = current;
    if (!state) return;
    // Netflix may pause internally while a programmatic seek is still loading.
    if (state.managedPause || Date.now() <= state.playbackGraceUntil ||
      isManagedNetflixSeek(state.expectedSeekTarget, state.expectedSeekUntil, Date.now())) return;
    clearLoop();
  }

  function onSeeking(event: Event): void {
    const state = current;
    if (!state) return;
    // A native seek may produce more than one seeking/seeked pair while the
    // player settles. Ignore a near-target follow-up inside the grace window.
    const video = event.currentTarget as HTMLVideoElement;
    const now = Date.now();
    if (isManagedNetflixSeek(state.expectedSeekTarget, state.expectedSeekUntil, now) ||
      (now <= state.playbackGraceUntil &&
        Math.abs(video.currentTime * 1000 - state.startMs) <= NETFLIX_SEEK_TOLERANCE_MS)) return;
    clearLoop(); // A user scrub or another extension overrides this loop.
  }

  function onSeeked(event: Event): void {
    const state = current;
    if (!state) return;
    const video = event.currentTarget as HTMLVideoElement;
    if (reachedNetflixSeekTarget(state.expectedSeekTarget, video.currentTime * 1000, video.seeking)) {
      state.expectedSeekTarget = null;
      state.expectedSeekUntil = 0;
    }
  }

  async function seek(state: Loop, ms: number): Promise<PageResponse> {
    state.expectedSeekTarget = ms;
    state.expectedSeekUntil = Date.now() + NETFLIX_SEEK_GRACE_MS;
    state.playbackGraceUntil = Date.now() + 3_500;
    const response = await requestPage("seekTo", ms);
    if (!response.ok || !response.seekCalled) {
      state.expectedSeekTarget = null;
      state.expectedSeekUntil = 0;
    }
    return response;
  }

  async function tick(state: Loop): Promise<void> {
    if (current !== state || state.busy || state.timeout !== null) return;
    state.busy = true;
    try {
      const video = state.video;
      if (location.pathname !== state.pathname || !video?.isConnected) {
        clearLoop();
        return;
      }

      const actualMs = video.currentTime * 1000;
      if (state.expectedSeekTarget !== null) {
        if (reachedNetflixSeekTarget(state.expectedSeekTarget, actualMs, video.seeking)) {
          state.expectedSeekTarget = null;
          state.expectedSeekUntil = 0;
        } else if (isManagedNetflixSeek(
          state.expectedSeekTarget, state.expectedSeekUntil, Date.now(),
        )) {
          return; // Wait for Netflix's asynchronous internal seek.
        } else {
          clearLoop(); // The requested seek never completed.
          return;
        }
      }
      if (video.seeking) return;
      if (video.paused) {
        if (state.managedPause || Date.now() <= state.playbackGraceUntil) return;
        clearLoop(); // Respect a user pause after playback has settled.
        return;
      }
      // The main-world API may select a different Netflix session as it loads.
      // The same HTML video element used for pause/seek events is the stable
      // source of actual playback time; no extra asynchronous status request.
      if (!Number.isFinite(actualMs) ||
        actualMs < state.startMs - 1_500 || actualMs > state.endMs + 5_000) {
        clearLoop();
        return;
      }
      if (!netflixLoopReachedEnd(actualMs, state.endMs)) return;

      state.count += 1;
      if (state.repeats !== "infinite" && state.count >= state.repeats) {
        // Finite repetition ends without forcing Netflix to pause.
        clearLoop();
        return;
      }

      if (state.delayMs > 0) {
        state.managedPause = true;
        const pause = await requestPage("pause");
        if (current !== state) return;
        if (!pause.ok) { clearLoop(); return; }
        state.timeout = setTimeout(() => {
          state.timeout = null;
          void (async () => {
            if (current !== state) return;
            const jumped = await seek(state, state.startMs);
            if (current !== state || !jumped.ok || !jumped.seekCalled) {
              clearLoop();
              return;
            }
            const played = await requestPage("play");
            if (current !== state || !played.ok) { clearLoop(); return; }
            state.playbackGraceUntil = Date.now() + 3_000;
            state.managedPause = false;
            state.busy = false;
          })().catch(() => clearLoop());
        }, state.delayMs);
      } else {
        const jumped = await seek(state, state.startMs);
        if (current !== state || !jumped.ok || !jumped.seekCalled) {
          clearLoop();
          return;
        }
        const played = await requestPage("play");
        if (current !== state || !played.ok) { clearLoop(); return; }
        state.playbackGraceUntil = Date.now() + 3_000;
      }
    } catch {
      clearLoop();
    } finally {
      if (current === state && state.timeout === null && !state.managedPause) {
        state.busy = false;
      }
    }
  }

  async function handle(message: Message): Promise<{ ok: boolean; error?: string; currentMs?: number; playing?: boolean; text?: string; language?: string }> {
    if (message.type === "NETFLIX_LOOP_CLEAR") {
      clearLoop();
      return { ok: true };
    }
    if (message.type === "NETFLIX_DIAGNOSE") {
      const diagnostic = await requestPage("diagnose");
      return { ok: diagnostic.ok, error: diagnostic.error, currentMs: diagnostic.currentMs,
        ...(typeof diagnostic.playing === "boolean" ? { playing: diagnostic.playing } : {}) };
    }
    if (message.type === "NETFLIX_SUBTITLES_GET") {
      if (!LEARNING_LANGUAGES.some(language => language === message.language)) {
        return { ok: false, error: "Unsupported subtitle language." };
      }
      const result = await requestPage("subtitlesGet", undefined, message.language);
      if (result.bridgeVersion !== "netflix-worker-url-check-v2") {
        return { ok: false, error: "The Netflix page has an outdated caption reader. Rebuild the extension and reload this watch tab before retrying." };
      }
      if (!result.ok || !result.text || !result.language) {
        return { ok: false, error: result.error ?? "Netflix did not provide a readable transcript." };
      }
      return { ok: true, text: result.text, language: result.language };
    }
    if (message.type === "NETFLIX_PLAYBACK_RATE_SET") {
      if (!Number.isFinite(message.rate) || message.rate < 0.5 || message.rate > 2) {
        return { ok: false, error: "Playback speed must be between 0.5× and 2×." };
      }
      // Changing playback rate does not cancel an active sentence loop.
      const result = await requestPage("setPlaybackRate", message.rate);
      return { ok: result.ok && typeof result.playbackRate === "number",
        error: result.error ?? (result.ok ? undefined : "Netflix could not change playback speed.") };
    }
    if (message.type === "NETFLIX_SEEK") {
      if (!Number.isInteger(message.timeMs) || message.timeMs < 0 || message.timeMs > 43_200_000) {
        return { ok: false, error: "Invalid timestamp." };
      }
      clearLoop();
      const result = await requestPage("seekTo", message.timeMs);
      if (!result.ok || !result.seekCalled) {
        return { ok: false, error: result.error ?? "Netflix could not seek to the subtitle timestamp." };
      }
      // Jump-to-cue is a playback action; merely positioning a paused video
      // would not let the user hear the sentence.
      const played = await requestPage("play");
      return { ok: played.ok, error: played.error ?? (played.ok ? undefined :
        "Netflix positioned the video, but could not start playback. Press Play in the video tab.") };
    }
    if (message.type !== "NETFLIX_LOOP_SET") return { ok: false, error: "Unsupported action." };
    if (!Number.isInteger(message.startMs) || !Number.isInteger(message.endMs)
      || message.startMs < 0 || message.endMs <= message.startMs
      || message.endMs - message.startMs > 600_000
      || ![0, 1, 2, 3].includes(message.delaySeconds)
      || !(message.repeats === "infinite" ||
        (Number.isInteger(message.repeats) && message.repeats >= 1 && message.repeats <= 20))) {
      return { ok: false, error: "Invalid loop settings." };
    }
    clearLoop();
    const diagnostic = await requestPage("diagnose");
    const video = findVideo();
    if (!diagnostic.ok || !video) {
      return { ok: false, error: diagnostic.error ?? "Netflix player is not ready for looping." };
    }
    const state: Loop = {
      startMs: message.startMs, endMs: message.endMs, repeats: message.repeats,
      delayMs: message.delaySeconds * 1000, count: 0, busy: false,
      managedPause: false, expectedSeekUntil: 0, expectedSeekTarget: null,
      playbackGraceUntil: 0, pathname: location.pathname, video, interval: null, timeout: null,
    };
    current = state;
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    const jumped = await seek(state, state.startMs);
    if (current !== state || !jumped.ok || !jumped.seekCalled) {
      clearLoop();
      return { ok: false, error: jumped.error ?? "Netflix could not seek to the start of the segment." };
    }
    const played = await requestPage("play");
    if (!played.ok) {
      clearLoop();
      return { ok: false, error: played.error ?? "Netflix could not start playback." };
    }
    state.playbackGraceUntil = Date.now() + 3_000;
    state.interval = setInterval(() => void tick(state), 100);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((incoming: unknown, _sender, sendResponse) => {
    if (!incoming || typeof incoming !== "object") return false;
    const candidate = incoming as Partial<Message>;
    if (candidate.type === "VIDEO_METADATA_GET") {
      const title = document.querySelector('[data-uia="video-title"]')?.textContent?.trim() ||
        document.querySelector('[data-uia="player-title"]')?.textContent?.trim() ||
        document.querySelector(".video-title h4")?.textContent?.trim() ||
        document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
        document.title;
      sendResponse({ ok: true, url: location.href, title });
      return false;
    }
    if (!["NETFLIX_DIAGNOSE", "NETFLIX_SEEK", "NETFLIX_LOOP_SET", "NETFLIX_LOOP_CLEAR", "NETFLIX_PLAYBACK_RATE_SET", "NETFLIX_SUBTITLES_GET"].includes(candidate.type ?? "")) {
      return false;
    }
    void handle(candidate as Message).then(sendResponse).catch(error => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Netflix playback is unavailable." });
    });
    return true;
  });

  window.addEventListener("pagehide", clearLoop);
})();
