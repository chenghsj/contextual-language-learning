import type { SpeechDownloadSnapshot } from "@contextual/core";

export const EMPTY_SPEECH_DOWNLOAD_SNAPSHOT: SpeechDownloadSnapshot = {
  type: "speechDownloadSnapshot",
  ready: false,
  revision: 0,
  service: "reconciling",
  paused: false,
  tasks: [],
};
