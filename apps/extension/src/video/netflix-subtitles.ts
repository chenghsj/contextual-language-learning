/** Browser-accessible caption documents only. Never decrypt media or fetch arbitrary URLs. */
export const MAX_SUBTITLE_BYTES = 2_000_000;
export const MAX_SUBTITLE_CUES = 3_000;
export const MAX_SUBTITLE_CHARS = 220_000;

export type SubtitleDocument = { text: string; language: string };

export function allowedNetflixSubtitleUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") &&
      ["netflix.com", "nflxvideo.net", "nflximg.net", "nflxext.com"].some(
        domain => host === domain || host.endsWith("." + domain),
      );
  } catch { return false; }
}

export function subtitleUrlFromTrack(track: unknown): string | null {
  if (!track || typeof track !== "object") return null;
  const source = track as Record<string, unknown>;
  const entries: unknown[] = [];
  if (source.ttDownloadables && typeof source.ttDownloadables === "object") {
    const downloadables = source.ttDownloadables as Record<string, unknown>;
    for (const name of ["webvtt-lssdh-ios8", "dfxp-ls-sdh", "imsc1.1", "simplesdh"]) {
      if (name in downloadables) entries.push(downloadables[name]);
    }
  }
  entries.push(source);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const info = entry as Record<string, unknown>;
    const candidates: unknown[] = [];
    if (Array.isArray(info.urls)) {
      candidates.push(...info.urls.map(item => item && typeof item === "object" ? item.url : item));
    }
    if (info.downloadUrls && typeof info.downloadUrls === "object") {
      candidates.push(...Object.values(info.downloadUrls));
    }
    if (typeof info.url === "string") candidates.push(info.url);
    for (const candidate of candidates) {
      if (typeof candidate === "string" && allowedNetflixSubtitleUrl(candidate)) return candidate;
    }
  }
  return null;
}

export function subtitleClockMs(value: string, frameRate = 30): number | null {
  const clock = value.trim().match(/^(\d{1,3}):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3})|:(\d{1,2}))?$/);
  if (clock) {
    const ms = ((Number(clock[1]) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000;
    if (clock[5] !== undefined) return ms + Math.round(Number(clock[5]) / frameRate * 1000);
    return ms + Number((clock[4] ?? "").padEnd(3, "0"));
  }
  const offset = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!offset) return null;
  return Math.round(Number(offset[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[offset[2]] ?? 1));
}

export function formatVttClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return String(Math.floor(seconds / 3600)).padStart(2, "0") + ":" +
    String(Math.floor(seconds / 60) % 60).padStart(2, "0") + ":" +
    String(seconds % 60).padStart(2, "0") + "." +
    String(ms % 1000).padStart(3, "0");
}

export function normalizedVttCues(cues: readonly { startMs: number; endMs: number; text: string }[]): string {
  let size = 0;
  if (cues.length === 0 || cues.length > MAX_SUBTITLE_CUES) throw new Error("No usable subtitle cues or too many cues.");
  const lines: string[] = ["WEBVTT", ""];
  for (const cue of cues) {
    const text = cue.text.replace(/\r/g, "").replace(/[\t ]+/g, " ").trim();
    if (!text || cue.startMs < 0 || cue.endMs <= cue.startMs) continue;
    size += text.length;
    if (size > MAX_SUBTITLE_CHARS) throw new Error("Subtitle text is too long. Select a shorter video.");
    lines.push(formatVttClock(Math.round(cue.startMs)) + " --> " + formatVttClock(Math.round(cue.endMs)), text, "");
  }
  if (lines.length <= 2) throw new Error("No usable subtitle cues were found.");
  return lines.join("\n");
}

function xmlText(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  if ((node as Element).localName === "br") return "\n";
  return Array.from(node.childNodes).map(xmlText).join("");
}

export function normalizeNetflixTimedText(
  input: string, parseXml: (input: string) => Document =
    text => new DOMParser().parseFromString(text, "application/xml"),
): string {
  if (input.length > MAX_SUBTITLE_BYTES) throw new Error("Subtitle document exceeds the size limit.");
  const body = input.trim().replace(/^\uFEFF/, "");
  if (/^WEBVTT(?:\s|$)/.test(body)) return body;
  if (!body.startsWith("<")) throw new Error("Netflix did not return a supported subtitle document.");
  const xml = parseXml(body);
  if (xml.getElementsByTagName("parsererror").length) throw new Error("Netflix subtitle XML is invalid.");
  const root = xml.documentElement;
  const rate = Number(root?.getAttribute("ttp:frameRate") ?? root?.getAttribute("frameRate") ?? 30);
  const frameRate = Number.isFinite(rate) && rate > 0 ? rate : 30;
  const cues: { startMs: number; endMs: number; text: string }[] = [];
  const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"));
  for (const paragraph of paragraphs) {
    const begin = subtitleClockMs(paragraph.getAttribute("begin") ?? "", frameRate);
    const end = subtitleClockMs(paragraph.getAttribute("end") ?? "", frameRate);
    const duration = subtitleClockMs(paragraph.getAttribute("dur") ?? "", frameRate);
    if (begin === null) continue;
    const until = end ?? (duration === null ? null : begin + duration);
    if (until === null || until <= begin) continue;
    const text = xmlText(paragraph).replace(/[ \t]+/g, " ").trim();
    if (text) cues.push({ startMs: begin, endMs: until, text });
    if (cues.length > MAX_SUBTITLE_CUES) throw new Error("Too many subtitle cues.");
  }
  return normalizedVttCues(cues);
}
