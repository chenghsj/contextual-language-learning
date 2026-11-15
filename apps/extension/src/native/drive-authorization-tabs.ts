/** Own each Google login tab separately from generation and other panels. */
export type AuthorizationTabs = Pick<typeof chrome.tabs, "create" | "remove" | "onRemoved">;
export function createDriveAuthorizationTabs(
  tabs: AuthorizationTabs | undefined,
  cancel: (loginId: string) => void,
) {
  const sessions = new Map<string, { tabId?: number }>();
  tabs?.onRemoved.addListener(tabId => {
    for (const [id, session] of sessions) {
      if (session.tabId !== tabId) continue;
      sessions.delete(id);
      cancel(id);
    }
  });
  return {
    start(id: string, address: string) {
      if (sessions.has(id)) return;
      const url = new URL(address);
      if (
        !tabs ||
        url.origin !== "https://accounts.google.com" ||
        url.pathname !== "/o/oauth2/v2/auth"
      ) {
        cancel(id);
        return;
      }
      const session: { tabId?: number } = {};
      sessions.set(id, session);
      void tabs
        .create({ url: address, active: true })
        .then(tab => {
          if (sessions.get(id) !== session) {
            if (tab.id !== undefined) void tabs.remove(tab.id).catch(() => {});
            return;
          }
          if (tab.id === undefined) {
            sessions.delete(id);
            cancel(id);
          } else session.tabId = tab.id;
        })
        .catch(() => {
          if (sessions.get(id) !== session) return;
          sessions.delete(id);
          cancel(id);
        });
    },
    finish(id: string) {
      sessions.delete(id);
    },
    finishAll() {
      sessions.clear();
    },
  };
}
