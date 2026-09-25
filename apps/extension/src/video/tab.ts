import type { VideoAdapter } from "./types";

export async function findVideoTab(adapter: VideoAdapter, sourceUrl: string): Promise<chrome.tabs.Tab> {
  const expectedId = adapter.getVideoId(sourceUrl);
  if (!expectedId) throw new Error("影片來源網址無效，請確認目前的網址。");
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(candidate => candidate.id !== undefined &&
    adapter.getVideoId(candidate.url) === expectedId);
  if (!tab?.id) throw new Error("請先在 Chrome 開啟教材所屬的影片分頁。");
  return tab;
}

export async function sendToVideo<T extends { ok: boolean; error?: string }>(
  adapter: VideoAdapter, sourceUrl: string, message: unknown, activate = false,
): Promise<T> {
  const tab = await findVideoTab(adapter, sourceUrl);
  const response = await chrome.tabs.sendMessage(tab.id!, message) as T | undefined;
  if (!response?.ok) throw new Error(response?.error ?? "播放器無法執行這個操作。");
  if (activate) await chrome.tabs.update(tab.id!, { active: true });
  return response;
}
