type LoopMessage =
  | { type: "LOOP_SET"; startMs: number; endMs: number; repeats: number | "infinite"; delaySeconds: number }
  | { type: "LOOP_CLEAR" };

let active: { video: HTMLVideoElement; start: number; end: number; repeats: number | "infinite"; completed: number; delayMs: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let managedPause = false;
let internalSeek = false;

function clearLoop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (active) {
    active.video.removeEventListener("timeupdate", onTimeUpdate);
    active.video.removeEventListener("pause", onPause);
    active.video.removeEventListener("seeking", onSeeking);
  }
  active = null;
  managedPause = false;
  internalSeek = false;
}

function seek(video: HTMLVideoElement, position: number): void {
  internalSeek = true;
  video.addEventListener("seeked", () => { internalSeek = false; }, { once: true });
  video.currentTime = position;
}

function onPause(): void {
  if (active && !managedPause) clearLoop();
}

function onSeeking(): void {
  if (active && !internalSeek) clearLoop();
}

function onTimeUpdate(): void {
  const state = active;
  if (!state || timer !== null || state.video.currentTime < state.end) return;
  state.completed += 1;
  if (state.repeats !== "infinite" && state.completed >= state.repeats) {
    managedPause = true;
    state.video.pause();
    clearLoop();
    return;
  }
  managedPause = true;
  state.video.pause();
  timer = setTimeout(() => {
    timer = null;
    if (active !== state) return;
    seek(state.video, state.start);
    managedPause = false;
    void state.video.play().catch(() => clearLoop());
  }, state.delayMs);
}

chrome.runtime.onMessage.addListener((message: LoopMessage, _sender, respond) => {
  if (message.type === "LOOP_CLEAR") {
    clearLoop();
    respond({ ok: true });
    return;
  }
  if (message.type !== "LOOP_SET") return;
  const video = document.querySelector<HTMLVideoElement>("video.html5-main-video") ??
    document.querySelector<HTMLVideoElement>("video");
  if (!video) {
    respond({ ok: false, error: "No YouTube video player is available in this tab." });
    return;
  }
  if (!Number.isFinite(message.startMs) || !Number.isFinite(message.endMs) ||
      message.startMs < 0 || message.endMs <= message.startMs ||
      message.endMs - message.startMs > 600000 ||
      ![0, 1, 2, 3].includes(message.delaySeconds) ||
      !(message.repeats === "infinite" || Number.isInteger(message.repeats) && message.repeats >= 1 && message.repeats <= 20)) {
    respond({ ok: false, error: "Invalid loop range or repeat setting." });
    return;
  }
  clearLoop();
  active = {
    video,
    start: message.startMs / 1000,
    end: message.endMs / 1000,
    repeats: message.repeats,
    delayMs: message.delaySeconds * 1000,
    completed: 0,
  };
  video.addEventListener("timeupdate", onTimeUpdate);
  video.addEventListener("pause", onPause);
  video.addEventListener("seeking", onSeeking);
  seek(video, message.startMs / 1000);
  void video.play().catch(() => clearLoop());
  respond({ ok: true });
});
