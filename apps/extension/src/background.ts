import { fetchNetflixCaptionText } from "./video/netflix-caption-fetch";

function isNetflixWatchPage(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["www.netflix.com", "netflix.com"].includes(url.hostname.toLowerCase()) &&
      /^\/watch\/\d+(?:\/|$)/.test(url.pathname);
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((incoming: unknown, sender, respond) => {
  if (!incoming || typeof incoming !== "object" ||
      (incoming as { type?: string }).type !== "NETFLIX_CAPTION_DOCUMENT_FETCH") return false;
  const url = (incoming as { url?: unknown }).url;
  // Only the top-level content script on the user's Netflix watch tab may
  // request a caption document. The URL itself is independently allowlisted.
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      !sender.tab || !isNetflixWatchPage(sender.tab.url) ||
      !isNetflixWatchPage(sender.url) ||
      typeof url !== "string" || url.length > 8192) {
    respond({ ok: false, error: "Caption requests require the current Netflix watch tab." });
    return false;
  }
  void fetchNetflixCaptionText(url).then(text => {
    respond({ ok: true, text });
  }).catch(error => {
    respond({ ok: false, error: error instanceof Error ? error.message : "Netflix subtitle request failed." });
  });
  return true;
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Chrome without Side Panel support will report an error when the extension loads.
});
