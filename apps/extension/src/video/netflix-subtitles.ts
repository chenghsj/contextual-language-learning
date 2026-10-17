/** Browser-accessible caption documents only. Never decrypt media or fetch arbitrary URLs. */
export const MAX_SUBTITLE_BYTES = 2_000_000;
export const MAX_SUBTITLE_CUES = 3_000;
export const MAX_SUBTITLE_CHARS = 220_000;

export type SubtitleDocument = { text: string; language: string };

export function allowedNetflixSubtitleUrl(input: string): boolean {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      ["netflix.com", "nflxvideo.net", "nflximg.net", "nflxext.com"].some(
        domain => host === domain || host.endsWith("." + domain),
      )
    );
  } catch {
    return false;
  }
}

export function subtitleUrlFromTrack(track: unknown): string | null {
  if (!track || typeof track !== "object") return null;
  const source = track as Record<string, unknown>;
  // Traverse only known subtitle delivery fields, not arbitrary player internals.
  function readableUrl(value: unknown, depth = 0): string | null {
    if (typeof value === "string") return allowedNetflixSubtitleUrl(value) ? value : null;
    if (!value || typeof value !== "object" || depth > 5) return null;
    const entries = Array.isArray(value) ? value.slice(0, 100) : Object.values(value).slice(0, 100);
    for (const entry of entries) {
      const url = readableUrl(entry, depth + 1);
      if (url) return url;
    }
    return null;
  }
  const entries: unknown[] = [];
  if (source.ttDownloadables && typeof source.ttDownloadables === "object") {
    const downloadables = source.ttDownloadables as Record<string, unknown>;
    for (const name of [
      "webvtt-lssdh-ios8",
      "webvtt-lssdh",
      "dfxp-ls-sdh",
      "imsc1.1",
      "simplesdh",
    ]) {
      if (name in downloadables) entries.push(downloadables[name]);
    }
  }
  entries.push(source.urls, source.downloadUrls, source.url);
  for (const entry of entries) {
    const url = readableUrl(entry);
    if (url) return url;
  }
  return null;
}

export function subtitleClockMs(
  value: string,
  frameRate = 30,
  tickRate = 1,
  subFrameRate = 1,
): number | null {
  const raw = value.trim();
  const clock = raw.match(/^(\d+):([0-5]\d):([0-5]\d)(?:[.,](\d+)|:(\d+)(?:\.(\d+))?)?$/);
  if (clock) {
    const base = ((Number(clock[1]) * 60 + Number(clock[2])) * 60 + Number(clock[3])) * 1000;
    let extra = 0;
    if (clock[4] !== undefined) {
      // TTML fractions can have more than three digits; 00:00:01.234567
      // represents 1234.567 ms, not an invalid clock expression.
      extra = Number("0." + clock[4]) * 1000;
    } else if (clock[5] !== undefined) {
      if (
        !Number.isFinite(frameRate) ||
        frameRate <= 0 ||
        !Number.isFinite(subFrameRate) ||
        subFrameRate <= 0
      )
        return null;
      const frame =
        Number(clock[5]) + (clock[6] === undefined ? 0 : Number(clock[6]) / subFrameRate);
      extra = (frame / frameRate) * 1000;
    }
    const result = base + extra;
    return Number.isFinite(result) && result >= 0 ? Math.round(result) : null;
  }

  const offset = raw.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|f|t)$/);
  if (!offset) return null;
  const amount = Number(offset[1]);
  const scale: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    f: 1000 / frameRate,
    t: 1000 / tickRate,
  };
  const result = amount * scale[offset[2]];
  return Number.isFinite(result) && result >= 0 ? Math.round(result) : null;
}

export function formatVttClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return (
    String(Math.floor(seconds / 3600)).padStart(2, "0") +
    ":" +
    String(Math.floor(seconds / 60) % 60).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0") +
    "." +
    String(ms % 1000).padStart(3, "0")
  );
}

export function normalizedVttCues(
  cues: readonly { startMs: number; endMs: number; text: string }[],
): string {
  let size = 0;
  if (cues.length === 0 || cues.length > MAX_SUBTITLE_CUES)
    throw new Error("No usable subtitle cues or too many cues.");
  const lines: string[] = ["WEBVTT", ""];
  for (const cue of cues) {
    const text = cue.text
      .replace(/\r/g, "")
      .replace(/[\t ]+/g, " ")
      .trim();
    if (!text || cue.startMs < 0 || cue.endMs <= cue.startMs) continue;
    size += text.length;
    if (size > MAX_SUBTITLE_CHARS)
      throw new Error("Subtitle text is too long. Select a shorter video.");
    lines.push(
      formatVttClock(Math.round(cue.startMs)) + " --> " + formatVttClock(Math.round(cue.endMs)),
      text,
      "",
    );
  }
  if (lines.length <= 2) throw new Error("No usable subtitle cues were found.");
  return lines.join("\n");
}

function xmlCueSerializer(xml: Document): (node: Node) => string {
  const namespace = "http://www.w3.org/ns/ttml#styling";
  const styles = new Map<string, Element>();
  for (const style of Array.from(xml.getElementsByTagNameNS("*", "style"))) {
    if (style.localName !== "style") continue;
    const id = style.getAttribute("xml:id") ?? style.getAttribute("id");
    if (id) styles.set(id, style);
  }
  function property(element: Element, name: string, seen = new Set<Element>()): string | null {
    if (seen.has(element)) return null;
    seen.add(element);
    const own = element.getAttributeNS?.(namespace, name) ?? element.getAttribute?.("tts:" + name);
    if (own !== null && own !== undefined) return own;
    // Later style references override earlier ones. Ruby roles themselves do not inherit.
    const refs = (element.getAttribute?.("style") ?? "").trim().split(/\s+/).reverse();
    for (const ref of refs) {
      const style = styles.get(ref);
      if (!style) continue;
      const value = property(style, name, seen);
      if (value !== null) return value;
    }
    return null;
  }
  const role = (element: Element) => property(element, "ruby");
  function position(element: Element): "over" | "under" {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const value = property(current, "rubyPosition");
      if (value) return value === "after" ? "under" : "over";
      if (/ruby-position\s*:\s*under\b/i.test(current.getAttribute?.("style") ?? ""))
        return "under";
    }
    return "over";
  }
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function content(node: Node): string {
    return Array.from(node.childNodes).map(serialize).join("");
  }
  function serialize(node: Node): string {
    if (node.nodeType === 3 || node.nodeType === 4) return escape(node.nodeValue ?? "");
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    if (element.localName === "br") return "\n";
    if (element.localName === "ruby")
      return `<ruby.${position(element)}>${content(element)}</ruby>`;
    if (element.localName === "rt" || element.localName === "rp")
      return `<${element.localName}>${content(element)}</${element.localName}>`;
    const rubyRole = role(element);
    if (rubyRole === "container") {
      const bases: Element[] = [],
        readings: Element[] = [];
      function collect(parent: Node) {
        for (const child of Array.from(parent.childNodes)) {
          if (child.nodeType !== 1) continue;
          const item = child as Element,
            itemRole = role(item);
          if (itemRole === "base") bases.push(item);
          else if (itemRole === "text") readings.push(item);
          else if (itemRole !== "delimiter" && itemRole !== "container") collect(item);
        }
      }
      collect(element);
      // Grouped bases/readings must pair exactly; never guess an ambiguous association.
      if (bases.length && bases.length === readings.length)
        return bases
          .map(
            (base, index) =>
              `<ruby.${position(readings[index])}>${content(base)}<rt>${content(readings[index])}</rt></ruby>`,
          )
          .join("");
      return bases.length ? bases.map(content).join("") : content(element);
    }
    if (["text", "textContainer", "delimiter"].includes(rubyRole ?? "")) return "";
    return content(element);
  }
  return serialize;
}

export function normalizeNetflixTimedText(
  input: string,
  parseXml: (input: string) => Document = text =>
    new DOMParser().parseFromString(text, "application/xml"),
): string {
  if (input.length > MAX_SUBTITLE_BYTES)
    throw new Error("Subtitle document exceeds the size limit.");
  const body = input.trim().replace(/^\uFEFF/, "");
  if (/^WEBVTT(?:\s|$)/.test(body)) return body;
  if (!body.startsWith("<"))
    throw new Error("Netflix did not return a supported subtitle document.");
  const xml = parseXml(body);
  if (xml.getElementsByTagName("parsererror").length)
    throw new Error("Netflix subtitle XML is invalid.");
  const root = xml.documentElement;
  if (!root || !["tt", "timedtext"].includes(root.localName)) {
    throw new Error("Netflix returned an unsupported subtitle XML format.");
  }
  // Respect TTML timing parameters rather than assuming each <p> contains
  // an hh:mm:ss.mmm clock. Netflix can deliver fractional seconds, frame and
  // tick offsets, and timed paragraphs relative to their ancestor containers.
  const ttmlParameterNamespace = "http://www.w3.org/ns/ttml#parameter";
  const rootParameter = (name: string): string | null =>
    root.getAttributeNS?.(ttmlParameterNamespace, name) ??
    root.getAttribute("ttp:" + name) ??
    root.getAttribute(name);
  const baseRateRaw = rootParameter("frameRate");
  const baseRate = Number(baseRateRaw ?? 30);
  const multiplierRaw = rootParameter("frameRateMultiplier") ?? "1 1";
  const multiplierMatch = multiplierRaw.trim().match(/^(\d+)\s+(\d+)$/);
  const multiplier =
    multiplierMatch && Number(multiplierMatch[2]) > 0
      ? Number(multiplierMatch[1]) / Number(multiplierMatch[2])
      : 1;
  const frameRate =
    Number.isFinite(baseRate * multiplier) && baseRate * multiplier > 0
      ? baseRate * multiplier
      : 30;
  const subFrameRateRaw = Number(rootParameter("subFrameRate") ?? 1);
  const subFrameRate =
    Number.isFinite(subFrameRateRaw) && subFrameRateRaw > 0 ? subFrameRateRaw : 1;
  const tickRateRaw = rootParameter("tickRate");
  const computedTickRate =
    tickRateRaw === null
      ? baseRateRaw === null
        ? 1
        : frameRate * subFrameRate
      : Number(tickRateRaw);
  const tickRate = Number.isFinite(computedTickRate) && computedTickRate > 0 ? computedTickRate : 1;
  const parseTime = (expression: string | null): number | null =>
    subtitleClockMs(expression ?? "", frameRate, tickRate, subFrameRate);

  const cues: { startMs: number; endMs: number; text: string }[] = [];
  const xmlText = xmlCueSerializer(xml);
  const paragraphs = Array.from(xml.getElementsByTagNameNS("*", "p"));
  if (!paragraphs.length)
    throw new Error("Netflix subtitle XML contains no timed-text paragraphs.");
  for (const paragraph of paragraphs) {
    // TTML begin/end are relative to the enclosing time container. Account
    // for nested <body>/<div> offsets without inventing missing cue timings.
    let parentOffset = 0;
    let validParent = true;
    const ancestors: Element[] = [];
    for (
      let parent = paragraph.parentElement;
      parent && parent !== root;
      parent = parent.parentElement
    ) {
      ancestors.push(parent);
    }
    for (const ancestor of ancestors.reverse()) {
      const rawBegin = ancestor.getAttribute("begin");
      if (!rawBegin) continue;
      const offset = parseTime(rawBegin);
      if (offset === null) {
        validParent = false;
        break;
      }
      parentOffset += offset;
    }
    if (!validParent) continue;

    const rawBegin = paragraph.getAttribute("begin");
    const rawEnd = paragraph.getAttribute("end");
    const rawDuration = paragraph.getAttribute("dur");
    let begin = parseTime(rawBegin);
    let end = parseTime(rawEnd);
    let duration = parseTime(rawDuration);

    // Some timedtext documents use numeric millisecond offsets, t and d.
    // These fields are not TTML ticks and must not use ttp:tickRate.
    if (root.localName === "timedtext" && rawBegin === null) {
      const t = paragraph.getAttribute("t");
      if (t !== null && /^\d+(?:\.\d+)?$/.test(t)) begin = Number(t);
    }
    if (root.localName === "timedtext" && rawDuration === null) {
      const d = paragraph.getAttribute("d");
      if (d !== null && /^\d+(?:\.\d+)?$/.test(d)) duration = Number(d);
    }
    if (begin === null || !Number.isFinite(begin)) continue;
    begin += parentOffset;
    if (end !== null) end += parentOffset;
    const until = end ?? (duration === null ? null : begin + duration);
    if (until === null || !Number.isFinite(until) || until <= begin) continue;
    const text = xmlText(paragraph)
      .replace(/[ \t]+/g, " ")
      .trim();
    if (text) cues.push({ startMs: begin, endMs: until, text });
    if (cues.length > MAX_SUBTITLE_CUES) throw new Error("Too many subtitle cues.");
  }
  if (!cues.length) {
    // Only expose timing attributes, never protected subtitle text or signed
    // delivery addresses. This identifies the next unrecognized TTML variant.
    const sample = paragraphs[0];
    const describe = (value: string | null): string =>
      value === null ? "missing" : value.slice(0, 60).replace(/[^a-zA-Z0-9:.,+-]/g, "?");
    throw new Error(
      "Netflix subtitle XML has " +
        paragraphs.length +
        " paragraphs but no usable timed cues. First paragraph timing: begin=" +
        describe(sample.getAttribute("begin") ?? sample.getAttribute("t")) +
        ", end=" +
        describe(sample.getAttribute("end")) +
        ", dur=" +
        describe(sample.getAttribute("dur") ?? sample.getAttribute("d")) +
        ", tickRate=" +
        tickRate +
        ".",
    );
  }
  return normalizedVttCues(cues);
}
