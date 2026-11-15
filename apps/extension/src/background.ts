import { openNotificationDestination } from "./native/notification-navigation";
import { notifyAnalysisComplete, notifyLessonOutcome } from "./native/analysis-notifications";
import { fetchNetflixCaptionText } from "./video/netflix-caption-fetch";
import { validateNetflixCaptionSender } from "./video/netflix-caption-sender";
import { installGenerationController } from "./native/generation-controller";
import { installSpeechDownloadController } from "./native/speech-download-controller";

chrome.runtime.onMessage.addListener((incoming: unknown, sender, respond) => {
  if (
    !incoming ||
    typeof incoming !== "object" ||
    (incoming as { type?: string }).type !== "NETFLIX_CAPTION_DOCUMENT_FETCH"
  )
    return false;

  const message = incoming as { url?: unknown; watchId?: unknown };
  const tabId = sender.tab?.id;
  // Reject malformed requests before querying a tab or attempting network I/O.
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    typeof tabId !== "number" ||
    !Number.isInteger(tabId) ||
    typeof message.watchId !== "string" ||
    !/^\d{1,20}$/.test(message.watchId) ||
    typeof message.url !== "string" ||
    message.url.length > 8192
  ) {
    respond({
      ok: false,
      error: "Netflix caption request is missing a valid watch tab or video ID.",
    });
    return false;
  }

  // A Netflix content script can retain /browse as sender.url after a client-
  // side navigation to /watch/:id. Query the tab at request time, then verify
  // its actual watch ID and the original document's matching Netflix origin.
  void (async () => {
    const tab = await chrome.tabs.get(tabId);
    const reason = validateNetflixCaptionSender(
      sender,
      chrome.runtime.id,
      tab.url,
      message.watchId as string,
    );
    if (reason) {
      respond({ ok: false, error: reason });
      return;
    }
    const text = await fetchNetflixCaptionText(message.url as string);
    respond({ ok: true, text });
  })().catch(error => {
    respond({
      ok: false,
      error: error instanceof Error ? error.message : "Netflix subtitle request failed.",
    });
  });
  return true;
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // Chrome without Side Panel support will report an error when the extension loads.
});

// Long-running generation must belong to the worker, never to the Side Panel.
if ("onConnect" in chrome.runtime) {
  const gateway = installGenerationController(
    chrome.runtime,
    (jobId, title, documentId, kind) => {
      void notifyAnalysisComplete(jobId, title, documentId, kind).catch(() => {
        /* System notifications may be disabled. */
      });
    },
    (jobId, title, outcome) => {
      void notifyLessonOutcome(jobId, title, outcome).catch(() => {});
    },
  );
  installSpeechDownloadController(gateway);
}

// Cache the destination window before the click to keep sidePanel.open inside the user gesture.
let notificationWindowId: number | undefined;
void chrome.windows
  ?.getLastFocused()
  .then(window => {
    notificationWindowId = window.id;
  })
  .catch(() => {});
chrome.windows?.onFocusChanged.addListener(id => {
  if (id !== chrome.windows.WINDOW_ID_NONE) notificationWindowId = id;
});
function openNotification(id: string): void {
  void openNotificationDestination(id, notificationWindowId).catch(() => {});
}
chrome.notifications.onClicked.addListener(openNotification);
chrome.notifications.onButtonClicked.addListener(id => openNotification(id));
