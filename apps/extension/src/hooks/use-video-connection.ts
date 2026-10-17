import { useEffect, useState } from "react";
import type { VideoAdapter } from "../video/types";

type Connection = {
  adapter: VideoAdapter;
  sourceUrl: string;
  tabId?: number;
  connected: boolean;
  durationMs?: number;
};

/** Playback readiness can recover independently of subtitle data and video duration. */
export function useVideoConnection(adapter: VideoAdapter, sourceUrl: string, tabId?: number) {
  const [state, setState] = useState<Connection>();
  useEffect(() => {
    setState(undefined);
    if (!sourceUrl || !adapter.status) return;
    let live = true;
    let inFlight = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const update = (connected: boolean, durationMs?: number) => {
      setState(previous => {
        const duration = durationMs ?? previous?.durationMs;
        if (
          previous?.adapter === adapter &&
          previous.sourceUrl === sourceUrl &&
          previous.tabId === tabId &&
          previous.connected === connected &&
          previous.durationMs === duration
        )
          return previous;
        return { adapter, sourceUrl, tabId, connected, durationMs: duration };
      });
    };
    const check = async () => {
      if (!live || inFlight) return;
      inFlight = true;
      try {
        const status = await Promise.race([
          adapter.status!(sourceUrl),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error("Playback status timed out")), 2200);
          }),
        ]);
        if (!live) return;
        const connected =
          typeof status.currentMs === "number" &&
          Number.isFinite(status.currentMs) &&
          status.currentMs >= 0;
        const durationMs =
          typeof status.durationMs === "number" &&
          Number.isFinite(status.durationMs) &&
          status.durationMs > 0
            ? status.durationMs
            : undefined;
        update(connected, durationMs);
      } catch {
        if (live) update(false);
      } finally {
        if (timeout) clearTimeout(timeout);
        timeout = undefined;
        inFlight = false;
      }
    };
    const recheck = () => {
      void check();
    };
    const updated = (_id: number, change: { status?: string; url?: string }) => {
      if (change.status || change.url) recheck();
    };
    const visible = () => {
      if (document.visibilityState === "visible") recheck();
    };
    recheck();
    const timer = window.setInterval(recheck, 2000);
    chrome.tabs.onActivated.addListener(recheck);
    chrome.tabs.onUpdated.addListener(updated);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      if (timeout) clearTimeout(timeout);
      window.clearInterval(timer);
      chrome.tabs.onActivated.removeListener(recheck);
      chrome.tabs.onUpdated.removeListener(updated);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [adapter, sourceUrl, tabId]);
  const current =
    state?.adapter === adapter && state.sourceUrl === sourceUrl && state.tabId === tabId
      ? state
      : undefined;
  return { connected: current?.connected ?? false, durationMs: current?.durationMs };
}
