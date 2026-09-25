/**
 * Validate a user-initiated caption request from the top-level Netflix content
 * script. Netflix is a single-page app: the sender's document can still have
 * its original /browse URL while the current tab is on /watch/<videoId>.
 * Always verify the tab's freshly queried URL, not the old document pathname.
 */
export type NetflixCaptionSender = {
  id?: string;
  frameId?: number;
  url?: string;
  origin?: string;
  tab?: { id?: number };
};

function netflixDocumentUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" ||
      !["netflix.com", "www.netflix.com"].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || (url.port && url.port !== "443")) return null;
    return url;
  } catch {
    return null;
  }
}

export function validateNetflixCaptionSender(
  sender: NetflixCaptionSender,
  extensionId: string,
  currentTabUrl: string | undefined,
  expectedWatchId: string,
): string | null {
  if (sender.id !== extensionId) return "Caption request did not originate from this extension.";
  if (sender.frameId !== 0 || typeof sender.tab?.id !== "number") {
    return "Caption requests must come from the top-level Netflix video tab.";
  }

  const current = netflixDocumentUrl(currentTabUrl);
  const currentWatchId = current?.pathname.match(/^\/watch\/(\d+)(?:\/|$)/)?.[1];
  if (!currentWatchId) return "The Netflix tab is not on a video watch page. Switch to the video and retry.";
  if (currentWatchId !== expectedWatchId) {
    return "The Netflix video changed during subtitle retrieval. Retry on the intended video.";
  }

  // The document URL may legitimately be /browse after client-side routing.
  // Its origin must still match the *current* Netflix watch tab's origin.
  const document = netflixDocumentUrl(sender.url ?? sender.origin);
  if (!document || document.origin !== current!.origin) {
    return "The subtitle request did not come from the current Netflix page.";
  }
  if (sender.origin !== undefined) {
    const origin = netflixDocumentUrl(sender.origin);
    if (!origin || origin.origin !== current!.origin) {
      return "The subtitle request has an unexpected document origin.";
    }
  }
  return null;
}
