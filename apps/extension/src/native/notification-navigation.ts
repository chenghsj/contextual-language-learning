import { notificationDestination } from "./analysis-notifications";
export const NOTIFICATION_ROUTE_KEY = "notificationNavigation";
/** Open immediately in the notification click event; awaiting storage would lose the user gesture. */
export async function openNotificationDestination(
  id: string,
  windowId: number | undefined,
  browser: typeof chrome = chrome,
): Promise<void> {
  const destination = notificationDestination(id);
  if (!destination) return;
  if (windowId !== undefined && browser.sidePanel?.open) {
    const saved = browser.storage.local.set({
      [NOTIFICATION_ROUTE_KEY]: { id, windowId, nonce: crypto.randomUUID() },
    });
    try {
      const opened = browser.sidePanel.open({ windowId });
      await Promise.all([saved, opened]);
      await browser.notifications.clear(id);
      return;
    } catch {
      await saved.catch(() => {});
      await browser.storage.local.remove(NOTIFICATION_ROUTE_KEY).catch(() => {});
    }
  }
  await browser.tabs.create({ url: browser.runtime.getURL(destination + "&web=1") });
  await browser.notifications.clear(id);
}
