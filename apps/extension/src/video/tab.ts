import type { VideoAdapter } from "./types";

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
  const current = await chrome.tabs.query({ active: true, currentWindow: true });
  const selected = current.find(tab => tabs.some(candidate => candidate.id === tab.id));
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

export async function sendToVideo<T extends { ok: boolean; error?: string }>(
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
  if (!response?.ok) throw new Error(response?.error ?? "播放器無法執行這個操作。");
  if (activate) await focusVideoTab(tab);
  return response;
}
