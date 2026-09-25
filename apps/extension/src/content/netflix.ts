// ISOLATED world: only handles user-initiated control requests from our Side Panel.
(() => {
  const REQUEST_EVENT = "immersive-learning:netflix:request";
  const RESPONSE_EVENT = "immersive-learning:netflix:response";
  type Action = "diagnose" | "status" | "seekTo" | "pause" | "play";
  type PageResponse = {
    source: "immersive-learning"; id: string; ok: boolean; available: boolean;
    currentMs?: number; playing?: boolean | null; sessionId?: string;
    seekCalled?: boolean; error?: string;
  };
  type Message =
    | { type: "NETFLIX_DIAGNOSE" }
    | { type: "NETFLIX_SEEK"; timeMs: number }
    | { type: "NETFLIX_LOOP_SET"; startMs: number; endMs: number; repeats: number | "infinite"; delaySeconds: number }
    | { type: "NETFLIX_LOOP_CLEAR" };
  type Loop = {
    startMs: number; endMs: number; repeats: number | "infinite"; delayMs: number;
    count: number; busy: boolean; managedPause: boolean; expectedSeekUntil: number;
    expectedSeekTarget: number | null; pathname: string; video: HTMLVideoElement | null;
    interval: ReturnType<typeof setInterval> | null;
    timeout: ReturnType<typeof setTimeout> | null;
  };
  let current: Loop | null = null;

  function requestPage(action: Action, value?: number): Promise<PageResponse> {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        window.removeEventListener(RESPONSE_EVENT, onResponse);
        resolve({ source: "immersive-learning", id, ok: false, available: false, error: "Netflix page bridge did not respond." });
      }, 700);
      function onResponse(event: Event): void {
        const detail = (event as CustomEvent<PageResponse>).detail;
        if (detail?.source !== "immersive-learning" || detail.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener(RESPONSE_EVENT, onResponse);
        resolve(detail);
      }
      window.addEventListener(RESPONSE_EVENT, onResponse);
      window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: { source: "immersive-learning", id, action, value },
      }));
    });
  }

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
    current = null;
  }

  function onPause(): void {
    if (current && !current.managedPause) clearLoop();
  }

  function onSeeking(event: Event): void {
    const state = current;
    if (!state) return;
    const video = event.currentTarget as HTMLVideoElement;
    const expected = state.expectedSeekTarget;
    if (expected !== null && Date.now() <= state.expectedSeekUntil
      && Math.abs(video.currentTime * 1000 - expected) <= 1500) {
      state.expectedSeekTarget = null;
      return;
    }
    clearLoop(); // Respect manual seeking, including other extension shortcuts.
  }

  async function seek(state: Loop, ms: number): Promise<PageResponse> {
    state.expectedSeekTarget = ms;
    state.expectedSeekUntil = Date.now() + 1500;
    const response = await requestPage("seekTo", ms);
    if (!response.ok || !response.seekCalled) {
      state.expectedSeekTarget = null;
    }
    return response;
  }

  async function tick(state: Loop): Promise<void> {
    if (current !== state || state.busy) return;
    state.busy = true;
    try {
      if (location.pathname !== state.pathname || !state.video?.isConnected) {
        clearLoop();
        return;
      }
      const status = await requestPage("status");
      if (current !== state) return;
      if (!status.ok || typeof status.currentMs !== "number" || status.playing === false) {
        clearLoop();
        return;
      }
      if (status.currentMs < state.startMs - 2000 || status.currentMs > state.endMs + 5000) {
        clearLoop();
        return;
      }
      if (status.currentMs < state.endMs - 90) return;
      state.count += 1;
      if (state.repeats !== "infinite" && state.count >= state.repeats) {
        // Do not force a pause on completion; let Netflix continue normally.
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
            if (current !== state || !jumped.ok || !jumped.seekCalled) { clearLoop(); return; }
            const played = await requestPage("play");
            if (!played.ok) { clearLoop(); return; }
            state.managedPause = false;
            state.busy = false;
          })().catch(() => clearLoop());
        }, state.delayMs);
      } else {
        const jumped = await seek(state, state.startMs);
        if (!jumped.ok || !jumped.seekCalled) clearLoop();
      }
    } catch {
      clearLoop();
    } finally {
      if (current === state && state.timeout === null) state.busy = false;
    }
  }

  async function handle(message: Message): Promise<{ ok: boolean; error?: string; currentMs?: number }> {
    if (message.type === "NETFLIX_LOOP_CLEAR") {
      clearLoop();
      return { ok: true };
    }
    if (message.type === "NETFLIX_DIAGNOSE") {
      const diagnostic = await requestPage("diagnose");
      return { ok: diagnostic.ok, error: diagnostic.error, currentMs: diagnostic.currentMs };
    }
    if (message.type === "NETFLIX_SEEK") {
      if (!Number.isInteger(message.timeMs) || message.timeMs < 0 || message.timeMs > 43_200_000) {
        return { ok: false, error: "Invalid timestamp." };
      }
      clearLoop();
      const result = await requestPage("seekTo", message.timeMs);
      return { ok: result.ok && result.seekCalled === true, error: result.error };
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
      pathname: location.pathname, video, interval: null, timeout: null,
    };
    current = state;
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
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
    state.interval = setInterval(() => void tick(state), 200);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((incoming: unknown, _sender, sendResponse) => {
    if (!incoming || typeof incoming !== "object") return false;
    const candidate = incoming as Partial<Message>;
    if (!["NETFLIX_DIAGNOSE", "NETFLIX_SEEK", "NETFLIX_LOOP_SET", "NETFLIX_LOOP_CLEAR"].includes(candidate.type ?? "")) {
      return false;
    }
    void handle(candidate as Message).then(sendResponse).catch(error => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Netflix playback is unavailable." });
    });
    return true;
  });

  window.addEventListener("pagehide", clearLoop);
})();
