import { isVideoCommandErrorCode, type VideoCommandErrorCode } from "./command-errors";
import type { VideoAdapter } from "./types";
import { VIDEO_READER_STATUS, VIDEO_READER_VERSION, RELOAD_READER_MESSAGE } from "./reader-health";

// Start slightly before the subtitle's timestamp so the listener hears the
// beginning of the utterance, and leave a small tail for inaccurate end times.
export const CUE_LEAD_IN_MS = 500;
export const CUE_TAIL_MS = 400;
export function cuePlaybackStart(startMs: number): number {
  if (!Number.isFinite(startMs) || startMs < 0) throw new Error("Invalid subtitle start time.");
  return Math.max(0, Math.round(startMs) - CUE_LEAD_IN_MS);
}
export function cuePlaybackWindow(startMs: number, endMs: number): { startMs: number; endMs: number } {
  if (!Number.isFinite(endMs) || endMs <= startMs) throw new Error("Invalid subtitle end time.");
  return { startMs: cuePlaybackStart(startMs), endMs: Math.round(endMs) + CUE_TAIL_MS };
}


/** Resolve the browser window hosting the Side Panel instead of relying on an
 * extension page's potentially stale currentWindow query. */
export async function getActiveWindowTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const current = await chrome.windows.getCurrent();
    if (typeof current.id === "number") {
      const [tab] = await chrome.tabs.query({ active: true, windowId: current.id });
      if (tab) return tab;
    }
  } catch {
    // Older Chromium builds may not resolve the Side Panel's current window.
  }
  const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return fallback ?? null;
}

function assertVideoId(adapter: VideoAdapter, sourceUrl: string): string {
  const id = adapter.getVideoId(sourceUrl);
  if (!id) throw new Error("影片來源網址無效，請確認目前的網址。");
  return id;
}

/** Only tabs showing this exact video are eligible; never choose a generic Netflix homepage. */
async function matchingVideoTabs(adapter: VideoAdapter, sourceUrl: string): Promise<chrome.tabs.Tab[]> {
  const expectedId = assertVideoId(adapter, sourceUrl);
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => tab.id !== undefined && adapter.getVideoId(tab.url) === expectedId);
}

async function chooseExistingVideoTab(tabs: chrome.tabs.Tab[]): Promise<chrome.tabs.Tab | null> {
  if (tabs.length === 0) return null;
  if (tabs.length === 1) return tabs[0];

  // Chrome's query order is not a selection policy: the first duplicate may be
  // paused, stale, or playing in a different window.
  const current = await getActiveWindowTab();
  const selected = tabs.find(candidate => candidate.id === current?.id);
  if (selected) return selected;

  // There may be one selected video in another window. Do not guess if several
  // windows contain active copies of the same film.
  const activeMatches = tabs.filter(tab => tab.active === true);
  if (activeMatches.length === 1) return activeMatches[0];

  throw new Error(
    "同一部影片已開啟多個分頁。請先切換到要控制的影片分頁，或關閉多餘分頁後再試；擴充功能不會任意選擇其中一個。",
  );
}

async function focusVideoTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) throw new Error("無法識別影片分頁。");
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined) {
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      // Chrome may block foregrounding a different window. The tab itself is selected.
    }
  }
}

export async function findVideoTab(adapter: VideoAdapter, sourceUrl: string): Promise<chrome.tabs.Tab> {
  const tab = await chooseExistingVideoTab(await matchingVideoTabs(adapter, sourceUrl));
  if (!tab) throw new Error("請先在 Chrome 開啟教材所屬的影片分頁，或使用「開啟／切換到影片」。");
  return tab;
}

/** Detect an outdated or missing content/page reader before waiting for a caption request. */
export async function assertVideoReaderReady(tab: chrome.tabs.Tab, adapter: VideoAdapter): Promise<void> {
  if (tab.id === undefined || !adapter.getVideoId(tab.url)) {
    throw new Error("找不到正確的影片分頁，請切換到要學習的影片。");
  }
  const current = await chrome.tabs.get(tab.id);
  if (adapter.getVideoId(current.url) !== adapter.getVideoId(tab.url)) {
    throw new Error("影片分頁已切換，請在目前播放的影片重試。");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: VIDEO_READER_STATUS }) as Promise<unknown>,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(RELOAD_READER_MESSAGE)), 2_200);
      }),
    ]) as { ok?: boolean; platform?: string; bridgeVersion?: string } | undefined;
    if (response?.ok !== true || response.platform !== adapter.id ||
      response.bridgeVersion !== VIDEO_READER_VERSION) throw new Error(RELOAD_READER_MESSAGE);
  } catch {
    throw new Error(RELOAD_READER_MESSAGE);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Reload only the already-open, matching watch tab, and only on explicit user action. */
export async function reloadExistingVideoTab(adapter: VideoAdapter, sourceUrl: string): Promise<void> {
  const tab = await findVideoTab(adapter, sourceUrl);
  if (tab.id === undefined) throw new Error("找不到正確的影片分頁。");
  const current = await chrome.tabs.get(tab.id);
  if (adapter.getVideoId(current.url) !== adapter.getVideoId(sourceUrl)) {
    throw new Error("影片分頁已切換，沒有重新載入其他影片。");
  }
  await chrome.tabs.reload(tab.id);
}

/** Reuse a matching watch tab; open at most one new tab only when none exists. */
export async function openOrFocusVideoTab(
  adapter: VideoAdapter, sourceUrl: string,
): Promise<{ tab: chrome.tabs.Tab; reused: boolean }> {
  const tabs = await matchingVideoTabs(adapter, sourceUrl);
  const existing = await chooseExistingVideoTab(tabs);
  if (existing) {
    await focusVideoTab(existing);
    return { tab: existing, reused: true };
  }
  const created = await chrome.tabs.create({ url: sourceUrl, active: true });
  return { tab: created, reused: false };
}

export class VideoCommandError extends Error {
  constructor(message: string, readonly code?: VideoCommandErrorCode) {
    super(message);
    this.name = "VideoCommandError";
  }
}

export async function sendToVideo<T extends { ok: boolean; error?: string; errorCode?: string }>(
  adapter: VideoAdapter, sourceUrl: string, message: unknown, activate = false,
): Promise<T> {
  const tab = await findVideoTab(adapter, sourceUrl);
  if (tab.id === undefined) throw new Error("無法識別影片分頁。");
  let response: T | undefined;
  try {
    response = await chrome.tabs.sendMessage(tab.id, message) as T | undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (/Receiving end does not exist|Could not establish connection/i.test(reason)) {
      throw new Error("影片分頁尚未載入擴充功能。請重新整理原本的影片分頁後重試，不必再開啟另一個分頁。");
    }
    throw error;
  }
  if (!response?.ok) throw new VideoCommandError(response?.error ?? "播放器無法執行這個操作。",
    isVideoCommandErrorCode(response?.errorCode) ? response.errorCode : undefined);
  if (activate) await focusVideoTab(tab);
  return response;
}
