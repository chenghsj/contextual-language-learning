import { useEffect, useState } from "react";
import { assertVideoReaderReady, findVideoTab, getActiveWindowTab } from "../video/tab";
import { needsVideoReaderReload } from "../video/reader-health";
import type { VideoAdapter } from "../video/types";

/** Check without interrupting playback; loading pages receive time to install their bridge. */
export function useVideoReaderHealth(adapter: VideoAdapter, sourceUrl: string | undefined, checkOnMount = true) {
  const [needsReload, setNeedsReload] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setNeedsReload(false);
    if (!sourceUrl || !["youtube", "netflix"].includes(adapter.id)) return;
    let live = true, inFlight = false;
    let armed = checkOnMount || revision > 0;
    const check = async () => {
      if (!armed || inFlight) return;
      inFlight = true;
      try {
        const tab = await findVideoTab(adapter, sourceUrl);
        if (tab.status === "loading") {
          if (live) setNeedsReload(false);
          return;
        }
        await assertVideoReaderReady(tab, adapter);
        // Reader health alone does not prove the playback transport is connected.
        if (adapter.status) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              adapter.status(sourceUrl),
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error("page bridge did not respond")), 2200);
              }),
            ]);
          } finally { if (timeout) clearTimeout(timeout); }
        }
        if (live) setNeedsReload(false);
      } catch (error) {
        if (!live) return;
        const reload = needsVideoReaderReload(error instanceof Error ? error.message : String(error));
        setNeedsReload(reload);
      } finally { inFlight = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 3000);
    const activated = (updatedId?: number) => {
      void getActiveWindowTab().then(tab => {
        if (!live || (updatedId !== undefined && tab?.id !== updatedId) || adapter.getVideoId(tab?.url) !== adapter.getVideoId(sourceUrl)) return;
        armed = true;
        void check();
      }).catch(() => undefined);
    };
    const updated = (_id: number, change: { status?: string; url?: string }) => {
      if (change.status === "complete" || change.url) activated(_id);
    };
    const onActivated = () => activated();
    chrome.tabs.onActivated?.addListener(onActivated);
    chrome.tabs.onUpdated?.addListener(updated);
    return () => {
      live = false;
      window.clearInterval(timer);
      chrome.tabs.onActivated?.removeListener(onActivated);
      chrome.tabs.onUpdated?.removeListener(updated);
    };
  }, [adapter, sourceUrl, revision, checkOnMount]);
  return { needsReload, recheck: () => { setNeedsReload(false); setRevision(value => value + 1); } };
}
