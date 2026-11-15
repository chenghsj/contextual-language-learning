import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { SpeechDownloadSnapshot } from "@contextual/core";
import { SpeechDownloads, EMPTY_SPEECH_DOWNLOAD_SNAPSHOT } from "../native/speech-download-client";

export type SpeechDownloadsPort = Pick<
  SpeechDownloads,
  | "snapshot"
  | "subscribe"
  | "subscribeNotices"
  | "start"
  | "cancel"
  | "retry"
  | "clearEnded"
  | "reconcile"
  | "close"
>;
const unavailable = () => Promise.reject(new Error("Speech download service is unavailable."));
const fallback: SpeechDownloadsPort = {
  snapshot: () => EMPTY_SPEECH_DOWNLOAD_SNAPSHOT,
  subscribe: () => () => {},
  subscribeNotices: () => () => {},
  start: unavailable,
  cancel: unavailable,
  retry: unavailable,
  clearEnded: unavailable,
  reconcile: unavailable,
  close: () => {},
};
const SpeechDownloadsContext = createContext<SpeechDownloadsPort>(fallback);

/** One client follows the side panel, including while settings and Activity are closed. */
export function SpeechDownloadsProvider({
  children,
  client,
}: {
  children: React.ReactNode;
  client?: SpeechDownloadsPort;
}) {
  const [ownedClient] = useState(() => client ?? new SpeechDownloads());
  useEffect(
    () => () => {
      if (!client) ownedClient.close();
    },
    [client, ownedClient],
  );
  return (
    <SpeechDownloadsContext.Provider value={ownedClient}>
      {children}
    </SpeechDownloadsContext.Provider>
  );
}

export function useSpeechDownloads(): SpeechDownloadsPort {
  return useContext(SpeechDownloadsContext);
}

export function useSpeechDownloadSnapshot(): SpeechDownloadSnapshot {
  const client = useSpeechDownloads();
  return useSyncExternalStore(
    client.subscribe,
    client.snapshot,
    () => EMPTY_SPEECH_DOWNLOAD_SNAPSHOT,
  );
}
