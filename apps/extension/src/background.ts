import { fetchNetflixCaptionText } from "./video/netflix-caption-fetch";
import { validateNetflixCaptionSender } from "./video/netflix-caption-sender";
import { installGenerationController } from "./native/generation-controller";

chrome.runtime.onMessage.addListener((incoming: unknown, sender, respond) => {
  if (!incoming || typeof incoming !== "object" ||
      (incoming as { type?: string }).type !== "NETFLIX_CAPTION_DOCUMENT_FETCH") return false;

  const message = incoming as { url?: unknown; watchId?: unknown };
  const tabId = sender.tab?.id;
  // Reject malformed requests before querying a tab or attempting network I/O.
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      typeof tabId !== "number" || !Number.isInteger(tabId) ||
      typeof message.watchId !== "string" || !/^\d{1,20}$/.test(message.watchId) ||
      typeof message.url !== "string" || message.url.length > 8192) {
    respond({ ok: false, error: "Netflix caption request is missing a valid watch tab or video ID." });
    return false;
  }

  // A Netflix content script can retain /browse as sender.url after a client-
  // side navigation to /watch/:id. Query the tab at request time, then verify
  // its actual watch ID and the original document's matching Netflix origin.
  void (async () => {
    const tab = await chrome.tabs.get(tabId);
    const reason = validateNetflixCaptionSender(sender, chrome.runtime.id, tab.url, message.watchId as string);
    if (reason) {
      respond({ ok: false, error: reason });
      return;
    }
    const text = await fetchNetflixCaptionText(message.url as string);
    respond({ ok: true, text });
  })().catch(error => {
    respond({ ok: false, error: error instanceof Error ? error.message : "Netflix subtitle request failed." });
  });
  return true;
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Chrome without Side Panel support will report an error when the extension loads.
});

// Long-running generation must belong to the worker, never to the Side Panel.
if ("onConnect" in chrome.runtime) installGenerationController();
