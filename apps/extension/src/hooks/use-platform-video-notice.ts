import { useCallback, useEffect, useRef, useState } from "react";
import { getVideoAdapter } from "../video";
import { assertVideoReaderReady, getActiveWindowTab } from "../video/tab";
import { needsVideoReaderReload } from "../video/reader-health";

/** Only browser navigation triggers this check; mounting the side panel does not. */
export function usePlatformVideoNotice(onNotice?: (message: string) => void, message = "") {
  const [recovery, setRecovery] = useState<chrome.tabs.Tab | null>(null);
  const [unavailable, setUnavailable] = useState<chrome.tabs.Tab | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<chrome.tabs.Tab | null>(null);
  const busyRef = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = useCallback(() => {
    pending.current = null;
    busyRef.current = false;
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    setRecovery(null);
    setUnavailable(null);
    setBusy(false);
    setFailed(false);
  }, []);
  const reload = useCallback(async () => {
    const target = pending.current;
    if (busyRef.current || target?.id === undefined || !target.url) return;
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const current = await chrome.tabs.get(target.id);
      if (pending.current !== target) return;
      const adapter = getVideoAdapter(target.url);
      if (adapter.getVideoId(current.url) !== adapter.getVideoId(target.url))
        throw new Error("Video changed");
      await chrome.tabs.reload(target.id);
      if (pending.current !== target) return;
      reloadTimer.current = setTimeout(() => {
        if (pending.current === target) {
          busyRef.current = false;
          setBusy(false);
          setFailed(true);
        }
      }, 15000);
    } catch {
      if (pending.current !== target) return;
      busyRef.current = false;
      setBusy(false);
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    let live = true,
      generation = 0;
    const notified = new Set<string>();
    const check = async (updatedId?: number) => {
      const tab = await getActiveWindowTab();
      if (!live || (updatedId !== undefined && tab?.id !== updatedId)) return;
      const request = ++generation;
      if (!tab?.url) {
        clear();
        return;
      }
      if (
        pending.current &&
        (pending.current.id !== tab.id ||
          getVideoAdapter(pending.current.url).getVideoId(pending.current.url) !==
            getVideoAdapter(tab.url).getVideoId(tab.url))
      )
        clear();
      if (tab.status === "loading") return;
      const adapter = getVideoAdapter(tab.url);
      if (adapter.id === "import") {
        clear();
        return;
      }
      const key = `${tab.id}:${adapter.getVideoId(tab.url)}`;
      try {
        await assertVideoReaderReady(tab, adapter);
        if (live && request === generation) {
          notified.delete(key);
          clear();
        }
      } catch (error) {
        if (
          !live ||
          request !== generation ||
          !needsVideoReaderReload(error instanceof Error ? error.message : String(error))
        )
          return;
        const current = await getActiveWindowTab();
        if (!live || request !== generation || current?.id !== tab.id || current?.url !== tab.url)
          return;
        if (notified.has(key)) return;
        notified.add(key);
        pending.current = tab;
        setRecovery(tab);
        setUnavailable(tab);
        onNotice?.(message);
      }
    };
    const activated = () => {
      void check().catch(() => undefined);
    };
    const updated = (_id: number, change: { status?: string; url?: string }) => {
      if (change.url || change.status) void check(_id).catch(() => undefined);
    };
    const timer = window.setInterval(() => {
      if (pending.current) void check(pending.current.id).catch(() => undefined);
    }, 1500);
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    return () => {
      live = false;
      pending.current = null;
      window.clearInterval(timer);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
    };
  }, [onNotice, message, clear]);
  const dismiss = useCallback(() => setRecovery(null), []);
  return { recovery, unavailable, busy, failed, reload, dismiss };
}
