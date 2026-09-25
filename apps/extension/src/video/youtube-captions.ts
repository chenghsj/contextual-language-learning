/** Only captions already offered by the active YouTube player are eligible. */
export type YouTubeCaptionTrack = {
  baseUrl: string;
  languageCode: string;
  kind?: string;
};

const MAX_CAPTION_CUES = 3_000;
const MAX_CAPTION_CHARS = 220_000;

export function readYouTubeCaptionTracks(value: unknown, videoId: string): YouTubeCaptionTrack[] {
  if (!value || typeof value !== "object") return [];
  const response = value as Record<string, unknown>;
  const videoDetails = response.videoDetails as Record<string, unknown> | undefined;
  if (videoDetails?.videoId !== videoId) return [];
  const captions = response.captions as Record<string, unknown> | undefined;
  const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
  const tracks = renderer?.captionTracks;
  if (!Array.isArray(tracks)) return [];
  return tracks.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    return typeof entry.baseUrl === "string" && typeof entry.languageCode === "string"
      ? [{ baseUrl: entry.baseUrl, languageCode: entry.languageCode,
        kind: typeof entry.kind === "string" ? entry.kind : undefined }]
      : [];
  }).slice(0, 100);
}

/** Prefer human-made captions, then auto-generated captions, in the requested language only. */
export function chooseYouTubeCaptionTrack(tracks: YouTubeCaptionTrack[], language: string): YouTubeCaptionTrack | null {
  const candidates = tracks.filter(track => track.languageCode.toLowerCase() === language ||
    track.languageCode.toLowerCase().startsWith(language + "-"));
  candidates.sort((a, b) =>
    Number(a.languageCode.toLowerCase() !== language) - Number(b.languageCode.toLowerCase() !== language) ||
    Number(a.kind === "asr") - Number(b.kind === "asr"));
  return candidates[0] ?? null;
}

export function allowedYouTubeCaptionUrl(source: string, videoId: string): URL {
  const url = new URL(source);
  if (url.protocol !== "https:" ||
    !["www.youtube.com", "youtube.com", "m.youtube.com"].includes(url.hostname) ||
    url.pathname !== "/api/timedtext" ||
    (url.searchParams.has("v") && url.searchParams.get("v") !== videoId)) {
    throw new Error("YouTube provided an unexpected subtitle address.");
  }
  return url;
}

function vttTime(milliseconds: number): string {
  const ms = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":") +
    "." + String(ms % 1000).padStart(3, "0");
}

/** Convert YouTube's JSON3 timed-text events into timestamped WEBVTT for the lesson pipeline. */
export function youtubeJson3ToVtt(input: string): string {
  if (input.length > 3_000_000) throw new Error("YouTube subtitles exceed the size limit.");
  let data: unknown;
  try { data = JSON.parse(input); }
  catch { throw new Error("YouTube did not return a readable subtitle document."); }
  if (!data || typeof data !== "object" || !Array.isArray((data as { events?: unknown }).events)) {
    throw new Error("YouTube did not return a readable subtitle document.");
  }
  const events = (data as { events: unknown[] }).events;
  const lines: string[] = ["WEBVTT", ""];
  let count = 0;
  let totalChars = 0;
  for (const item of events) {
    if (!item || typeof item !== "object") continue;
    const event = item as Record<string, unknown>;
    if (!Array.isArray(event.segs) || typeof event.tStartMs !== "number" ||
      !Number.isFinite(event.tStartMs) || event.tStartMs < 0) continue;
    const text = event.segs.map(segment =>
      segment && typeof segment === "object" && "utf8" in segment &&
      typeof segment.utf8 === "string" ? segment.utf8 : "").join("")
      .replace(/\s+/g, " ").trim();
    if (!text) continue;
    const duration = typeof event.dDurationMs === "number" && Number.isFinite(event.dDurationMs)
      ? Math.max(1, event.dDurationMs) : 2_000;
    if (text.length > 1_500 || ++count > MAX_CAPTION_CUES ||
      (totalChars += text.length) > MAX_CAPTION_CHARS) {
      throw new Error("YouTube subtitles exceed the lesson size limit; use a shorter video.");
    }
    lines.push(vttTime(event.tStartMs) + " --> " + vttTime(event.tStartMs + duration), text, "");
  }
  if (!count) throw new Error("YouTube did not provide any readable subtitle cues.");
  return lines.join("\n");
}

/** YouTube may return WEBVTT, JSON3 or a legacy XML timed-text document. */
export function youtubeXmlToVtt(
  input: string,
  parseXml: (source: string) => Document =
    source => new DOMParser().parseFromString(source, "application/xml"),
): string {
  if (input.length > 3_000_000) throw new Error("YouTube subtitles exceed the size limit.");
  const xml = parseXml(input);
  if (xml.getElementsByTagName("parsererror").length) {
    throw new Error("YouTube returned invalid subtitle XML.");
  }
  const kind = xml.documentElement?.localName;
  if (kind !== "transcript" && kind !== "timedtext") {
    throw new Error("YouTube returned an unsupported subtitle XML format.");
  }
  const entries = kind === "transcript"
    ? Array.from(xml.getElementsByTagName("text"))
    : Array.from(xml.getElementsByTagNameNS("*", "p"));
  const lines = ["WEBVTT", ""];
  let count = 0;
  let totalChars = 0;
  for (const entry of entries) {
    const start = kind === "transcript"
      ? Number(entry.getAttribute("start")) * 1000
      : Number(entry.getAttribute("t"));
    const duration = kind === "transcript"
      ? Number(entry.getAttribute("dur")) * 1000
      : Number(entry.getAttribute("d"));
    const text = (entry.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(start) || start < 0 ||
      !Number.isFinite(duration) || duration <= 0 || !text) continue;
    if (text.length > 1_500 || ++count > MAX_CAPTION_CUES ||
      (totalChars += text.length) > MAX_CAPTION_CHARS) {
      throw new Error("YouTube subtitles exceed the lesson size limit; use a shorter video.");
    }
    lines.push(vttTime(start) + " --> " + vttTime(start + duration), text, "");
  }
  if (!count) throw new Error("YouTube did not provide any readable subtitle cues.");
  return lines.join("\n");
}

export function youtubeTimedTextToVtt(input: string): string {
  const body = input.trim().replace(/^\uFEFF/, "");
  if (/^WEBVTT(?:\s|$)/.test(body)) return body;
  if (body.startsWith("{")) return youtubeJson3ToVtt(body);
  if (body.startsWith("<")) return youtubeXmlToVtt(body);
  throw new Error("YouTube did not return a readable subtitle document.");
}

/**
 * Reuse only caption URLs exposed to the currently playing video's browser
 * session. Resource Timing may contain a player-generated session token;
 * never log, persist or send these URLs outside the current watch page.
 */
export function observedYouTubeCaptionUrls(
  resources: readonly string[], videoId: string, language: string,
): string[] {
  const matches: { url: string; session: boolean }[] = [];
  const seen = new Set<string>();
  const wanted = language.toLowerCase();
  for (const raw of resources.slice(-2_000).reverse()) {
    let url: URL;
    try { url = allowedYouTubeCaptionUrl(raw, videoId); } catch { continue; }
    if (url.searchParams.get("v") !== videoId) continue;
    const actualLanguage = (url.searchParams.get("tlang") ??
      url.searchParams.get("lang") ?? "").toLowerCase();
    if (actualLanguage !== wanted && !actualLanguage.startsWith(wanted + "-")) continue;
    const address = url.toString();
    if (seen.has(address)) continue;
    seen.add(address);
    matches.push({ url: address, session: url.searchParams.has("pot") });
    if (matches.length >= 10) break;
  }
  return [
    ...matches.filter(entry => entry.session),
    ...matches.filter(entry => !entry.session),
  ].map(entry => entry.url);
}
