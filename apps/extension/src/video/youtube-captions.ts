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

type CaptionPiece = { text: string; offsetMs: number | null };
type CaptionInterval = { startMs: number; endMs: number; text: string };
const MIN_SPLIT_MS = 350;

/** Split only on source-provided segment offsets at clear punctuation or long pauses.
 * If offsets are absent, out of order, or too close together, keep the original
 * full caption rather than inventing a timestamp for each word or sentence. */
function splitTimedCaption(
  pieces: readonly CaptionPiece[], eventStartMs: number, eventEndMs: number,
): CaptionInterval[] {
  const timed = pieces.flatMap((piece, index) => piece.text.trim()
    ? [{ index, offsetMs: piece.offsetMs }] : []);
  if (timed.length < 2 || timed.some(part => part.offsetMs === null ||
    !Number.isFinite(part.offsetMs) || part.offsetMs < 0 ||
    eventStartMs + part.offsetMs >= eventEndMs)) return [];
  if (timed.some((part, index) => index > 0 && part.offsetMs! < timed[index - 1].offsetMs!)) return [];
  const result: CaptionInterval[] = [];
  let firstIndex = 0;
  let firstOffset = timed[0].offsetMs!;
  for (let index = 1; index < timed.length; index++) {
    const previous = timed[index - 1];
    const next = timed[index];
    const nextOffset = next.offsetMs!;
    const previousText = previous.index === 0 ? pieces[0].text : pieces[previous.index].text;
    const endsSentence = /[。.!?！？…]["'」』）)]?\s*$/.test(previousText);
    const longPause = nextOffset - previous.offsetMs! >= 1_200;
    const nextStart = eventStartMs + nextOffset;
    if (!(endsSentence || longPause) ||
      nextOffset - firstOffset < MIN_SPLIT_MS || eventEndMs - nextStart < MIN_SPLIT_MS) continue;
    const text = pieces.slice(firstIndex, next.index).map(piece => piece.text).join("")
      .replace(/\s+/g, " ").trim();
    if (!text) continue;
    result.push({ startMs: eventStartMs + firstOffset, endMs: nextStart, text });
    firstIndex = next.index;
    firstOffset = nextOffset;
  }
  if (!result.length) return [];
  const tail = pieces.slice(firstIndex).map(piece => piece.text).join("")
    .replace(/\s+/g, " ").trim();
  if (!tail) return [];
  result.push({ startMs: eventStartMs + firstOffset, endMs: eventEndMs, text: tail });
  return result;
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
  for (const [index, item] of events.entries()) {
    if (!item || typeof item !== "object") continue;
    const event = item as Record<string, unknown>;
    if (!Array.isArray(event.segs) || typeof event.tStartMs !== "number" ||
      !Number.isFinite(event.tStartMs) || event.tStartMs < 0) continue;
    const pieces: CaptionPiece[] = event.segs.map(segment => {
      const value = segment && typeof segment === "object"
        ? segment as Record<string, unknown> : {};
      return {
        text: typeof value.utf8 === "string" ? value.utf8 : "",
        offsetMs: typeof value.tOffsetMs === "number" && Number.isFinite(value.tOffsetMs)
          ? value.tOffsetMs : null,
      };
    });
    const text = pieces.map(piece => piece.text).join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // YouTube sometimes omits dDurationMs. The next real caption timestamp is
    // a safer available upper bound than a hard-coded 2-second truncation.
    const nextStartMs = events.slice(index + 1).find(next =>
      next && typeof next === "object" &&
      typeof (next as Record<string, unknown>).tStartMs === "number" &&
      Number.isFinite((next as { tStartMs: number }).tStartMs) &&
      (next as { tStartMs: number }).tStartMs > event.tStartMs!) as { tStartMs: number } | undefined;
    const duration = typeof event.dDurationMs === "number" &&
      Number.isFinite(event.dDurationMs) && event.dDurationMs > 0
      ? event.dDurationMs
      : nextStartMs ? Math.min(20_000, nextStartMs.tStartMs - event.tStartMs) : 2_000;
    const endMs = event.tStartMs + duration;
    const segmented = splitTimedCaption(pieces, event.tStartMs, endMs);
    const intervals = segmented.length
      ? segmented : [{ startMs: event.tStartMs, endMs, text }];
    // Preserve the full event's own size limit even if segments would be shorter.
    if (text.length > 1_500 || count + intervals.length > MAX_CAPTION_CUES ||
      (totalChars += intervals.reduce((sum, cue) => sum + cue.text.length, 0)) > MAX_CAPTION_CHARS) {
      throw new Error("YouTube subtitles exceed the lesson size limit; use a shorter video.");
    }
    count += intervals.length;
    for (const cue of intervals) {
      lines.push(vttTime(cue.startMs) + " --> " + vttTime(cue.endMs), cue.text, "");
    }
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

/** Accept only a readable body observed on the active player's timedtext request. */
export function parsePlayerYouTubeCaptionResponse(
  rawUrl: string, body: string, videoId: string,
): { videoId: string; language: string; kind: "asr" | "manual"; text: string } | null {
  if (!body.trim() || body.length > 3_000_000) return null;
  let url: URL;
  try { url = allowedYouTubeCaptionUrl(new URL(rawUrl, "https://www.youtube.com/").toString(), videoId); }
  catch { return null; }
  if (url.searchParams.get("v") !== videoId || url.searchParams.has("tlang")) return null;
  const language = (url.searchParams.get("lang") ?? "").toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(language)) return null;
  try {
    const text = youtubeTimedTextToVtt(body);
    if (text.length > 3_000_000 || !text.includes("-->")) return null;
    return {
      videoId, language,
      kind: url.searchParams.get("caps") === "asr" ? "asr" : "manual",
      text,
    };
  } catch { return null; }
}
