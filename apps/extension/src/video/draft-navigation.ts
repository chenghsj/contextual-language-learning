import { getVideoAdapter } from "./index";

/** Follow the selected video unless doing so would discard a manual transcript. */
export function shouldFollowSelectedVideo(
  sourceUrl: string, selectedUrl: string, raw: string, origin?: string,
): boolean {
  const selected = getVideoAdapter(selectedUrl);
  const source = getVideoAdapter(sourceUrl);
  if (!selected.getVideoId(selectedUrl)) return false;
  if (source.id === selected.id && source.getVideoId(sourceUrl) === selected.getVideoId(selectedUrl)) return false;
  return !raw.trim() || origin === "video";
}
