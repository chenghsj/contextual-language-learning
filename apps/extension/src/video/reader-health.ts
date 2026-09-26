/** A versioned, user-initiated probe. Old page scripts must never be mistaken for current readers. */
export const VIDEO_READER_STATUS = "IMMERSIVE_VIDEO_BRIDGE_STATUS";
export const VIDEO_READER_VERSION = "reader-health-v1";
export const RELOAD_READER_MESSAGE =
  "影片分頁的字幕讀取器尚未載入或版本過舊。請重新載入原本的影片分頁，再取得字幕。";

export function needsVideoReaderReload(message: string): boolean {
  return /outdated caption reader|caption reader.*outdated|字幕讀取器.*過舊|尚未載入擴充功能|reader did not respond|page bridge did not respond|reader-health-v1/i
    .test(message);
}
