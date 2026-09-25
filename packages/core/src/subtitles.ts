import type { SubtitleCue } from "./schema";

function timestampToMs(raw: string): number | null {
  const match = raw.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(match[4].padEnd(3, "0"));
}

export function parseSubtitles(input: string): SubtitleCue[] {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const timeIndex = lines.findIndex(line => line.includes("-->"));
    if (timeIndex < 0) continue;
    const [left, right] = lines[timeIndex].split("-->");
    if (!left || !right) continue;
    const startMs = timestampToMs(left);
    const endMs = timestampToMs(right.trim().split(/\s+/)[0]);
    if (startMs === null || endMs === null || endMs < startMs) continue;
    const originalText = lines.slice(timeIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!originalText) continue;
    cues.push({ id: "cue-" + (cues.length + 1), startMs, endMs, originalText });
  }
  return cues;
}

export function parsePlainText(input: string): SubtitleCue[] {
  const paragraphs = input.replace(/\r\n?/g, "\n").split(/\n\s*\n/)
    .map(text => text.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const segments: string[] = [];
  for (let remaining of paragraphs) {
    while (remaining.length > 1500) {
      const space = remaining.lastIndexOf(" ", 1500);
      const boundary = space >= 1000 ? space : 1500;
      segments.push(remaining.slice(0, boundary).trim());
      remaining = remaining.slice(boundary).trim();
    }
    if (remaining) segments.push(remaining);
  }
  return segments.map((originalText, index) => ({
    id: "cue-" + (index + 1),
    startMs: null,
    endMs: null,
    originalText,
  }));
}

/** A caption update can repeat the same displayed text in overlapping time ranges.
 * Keep its first source ID so AI selections still resolve into original cues.
 * A later, separately spoken repetition is preserved. This is only for curation:
 * the canonical transcript is never modified or discarded. */
export function normalizeLearningCues(cues: readonly SubtitleCue[]): SubtitleCue[] {
  const cleaned: SubtitleCue[] = [];
  for (const cue of cues) {
    const text = cue.originalText.trim().replace(/\s+/g, " ");
    if (!text || /^[♪♫～〜\s]+$/.test(text)) continue;
    const previous = cleaned[cleaned.length - 1];
    const repeatedOverlay = previous && previous.originalText === text &&
      previous.startMs !== null && previous.endMs !== null &&
      cue.startMs !== null && cue.endMs !== null &&
      cue.startMs <= previous.endMs + 100 && cue.startMs >= previous.startMs &&
      cue.startMs - previous.startMs < 1500;
    if (repeatedOverlay) {
      cleaned[cleaned.length - 1] = { ...previous, endMs: Math.max(previous.endMs!, cue.endMs!) };
    } else {
      cleaned.push({ ...cue, originalText: text });
    }
  }
  return cleaned;
}

export function chunkCues(cues: SubtitleCue[], maxChars = 4500, maxDurationMs = 300000): SubtitleCue[][] {
  const result: SubtitleCue[][] = [];
  let current: SubtitleCue[] = [];
  let size = 0;
  for (const cue of cues) {
    const duration = current.length && cue.endMs !== null && current[0].startMs !== null
      ? cue.endMs - current[0].startMs : 0;
    if (current.length && (size + cue.originalText.length > maxChars || duration > maxDurationMs)) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(cue);
    size += cue.originalText.length;
  }
  if (current.length) result.push(current);
  return result;
}

export function formatTime(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.floor(ms / 1000);
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  return hours ? hours + ":" + minutes + ":" + seconds : minutes + ":" + seconds;
}

export function youtubeTimeLink(url: string | undefined, ms: number | null): string | null {
  if (!url || ms === null) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const id = host === "youtu.be" ? parsed.pathname.slice(1)
      : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)
        ? parsed.searchParams.get("v") : null;
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    return "https://www.youtube.com/watch?v=" + id + "&t=" + Math.floor(ms / 1000) + "s";
  } catch {
    return null;
  }
}
