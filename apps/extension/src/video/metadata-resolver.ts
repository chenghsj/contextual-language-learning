import { getVideoAdapter } from "./index";
import { titleForVideoTab } from "./metadata";
import { findVideoTab, getActiveWindowTab } from "./tab";

export type DetectedVideoMetadata = {
  tabId: number;
  url: string;
  videoId: string;
  platform: string;
  title: string | null;
};

/**
 * An existing watch URL is the source of truth. Never silently use a different
 * active video when the lesson already identifies a particular video.
 */
export async function detectCurrentVideoMetadata(
  sourceUrl: string,
  retries = 2,
): Promise<DetectedVideoMetadata | null> {
  const sourceAdapter = getVideoAdapter(sourceUrl);
  const tab = sourceAdapter.id === "import"
    ? await getActiveWindowTab()
    : await findVideoTab(sourceAdapter, sourceUrl);
  if (tab?.id === undefined) return null;

  const adapter = getVideoAdapter(tab.url);
  const videoId = adapter.getVideoId(tab.url);
  if (adapter.id === "import" || !videoId) return null;
  if (sourceAdapter.id !== "import" &&
    (sourceAdapter.id !== adapter.id ||
      sourceAdapter.getVideoId(sourceUrl) !== videoId)) return null;

  const maxAttempts = Math.max(0, Math.min(3, Math.floor(retries)));
  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (attempt > 0) await new Promise<void>(resolve => setTimeout(resolve, 350));
    const currentTab = await chrome.tabs.get(tab.id);
    if (!currentTab.url || getVideoAdapter(currentTab.url).id !== adapter.id ||
      adapter.getVideoId(currentTab.url) !== videoId) {
      throw new Error("VIDEO_CHANGED");
    }
    const title = await titleForVideoTab(currentTab, adapter);
    // The player may navigate while titleForVideoTab awaits a content-script
    // response. Do not use stale metadata from a previous watch page.
    const verifiedTab = await chrome.tabs.get(tab.id);
    if (!verifiedTab.url || getVideoAdapter(verifiedTab.url).id !== adapter.id ||
      adapter.getVideoId(verifiedTab.url) !== videoId) {
      throw new Error("VIDEO_CHANGED");
    }
    if (title || attempt === maxAttempts) {
      // Without a saved source, the selected watch tab is the user's intent.
      // Do not fill in an old tab's metadata after the user has switched tabs.
      if (sourceAdapter.id === "import" &&
        (await getActiveWindowTab())?.id !== tab.id) {
        throw new Error("VIDEO_CHANGED");
      }
      return {
        tabId: tab.id, url: verifiedTab.url, videoId,
        platform: adapter.id, title,
      };
    }
  }
  return null;
}

/**
 * Never attach a different video's title/URL to previously imported subtitles.
 * An unlinked transcript can be paired only after explicit user confirmation.
 */
export function metadataSourceSafety(
  sourceUrl: string, transcript: string, candidateUrl: string,
): "safe" | "confirm" | "mismatch" {
  if (!transcript.trim()) return "safe";
  const source = getVideoAdapter(sourceUrl);
  const candidate = getVideoAdapter(candidateUrl);
  const sourceId = source.getVideoId(sourceUrl);
  if (!sourceId) return "confirm";
  return source.id === candidate.id && sourceId === candidate.getVideoId(candidateUrl)
    ? "safe" : "mismatch";
}
