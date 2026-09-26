import type { LearningLanguage } from "@immersive/core";
import { getVideoAdapter } from "./index";

/** A parsed transcript is usable only for its explicit source and requested language. */
export type CaptionProvenance = {
  sourceKey: string | null;
  language: LearningLanguage;
  origin: "video" | "manual";
  actualLanguage?: string;
};

export function videoSourceKey(url: string | undefined): string | null {
  const adapter = getVideoAdapter(url);
  const videoId = adapter.getVideoId(url);
  return adapter.id !== "import" && videoId ? adapter.id + ":" + videoId : null;
}

export function subtitleLanguageMatches(requested: LearningLanguage, returned: string): boolean {
  const actual = returned.trim().toLowerCase().replace(/_/g, "-");
  return actual === requested || actual.startsWith(requested + "-");
}

export function captionCacheKey(url: string | undefined, language: LearningLanguage): string {
  return (videoSourceKey(url) ?? "manual:" + (url?.trim() ?? "")) + "|" + language;
}

export function isCurrentCaption(
  caption: CaptionProvenance | null, language: LearningLanguage, sourceUrl: string | undefined,
): boolean {
  if (!caption || caption.language !== language || caption.sourceKey !== videoSourceKey(sourceUrl)) return false;
  if (caption.origin === "manual") return true; // The user has declared the imported language.
  return caption.sourceKey !== null && !!caption.actualLanguage &&
    subtitleLanguageMatches(language, caption.actualLanguage);
}
