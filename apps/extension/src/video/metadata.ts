import type { VideoAdapter } from "./types";

export type VideoTabMetadata = {
  id?: number;
  url?: string;
  title?: string;
};

type MetadataResponse = {
  ok?: boolean;
  title?: string;
  url?: string;
};

/** Never fill the lesson title with a generic browser tab label. */
export function cleanVideoTitle(value: string | null | undefined): string | null {
  const candidate = (value ?? "").replace(/\s+/g, " ").trim()
    .replace(/\s*[-–—|]\s*(?:Netflix|YouTube(?: Premium)?)(?:\s*(?:TW|台灣))?\s*$/i, "")
    .trim();
  if (!candidate || /^(?:netflix|youtube(?: premium)?|video|watch on netflix)$/i.test(candidate)) {
    return null;
  }
  return candidate.slice(0, 200);
}

/** Get the actual title from the current video page, falling back to Chrome's
 * tab title. Ignore metadata from a tab that has navigated to another video. */
export async function titleForVideoTab(
  tab: VideoTabMetadata,
  adapter: VideoAdapter,
): Promise<string | null> {
  const fallback = cleanVideoTitle(tab.title);
  const expectedId = adapter.getVideoId(tab.url);
  if (typeof tab.id !== "number" || !expectedId) return fallback;

  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "VIDEO_METADATA_GET",
    }) as MetadataResponse | undefined;
    if (result?.ok && result.url &&
      adapter.getVideoId(result.url) === expectedId) {
      return cleanVideoTitle(result.title) ?? fallback;
    }
  } catch {
    // A watch tab may still be loading or may have an older content script.
  }
  return fallback;
}
