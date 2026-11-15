export function youtubeVideo(
  url: string | undefined,
  startMs?: number | null,
): { id: string; start: number } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port)
      return null;
    const host = parsed.hostname.toLowerCase();
    const paths = parsed.pathname.split("/").filter(Boolean);
    let id: string | null = null;
    if (host === "youtu.be" && paths.length === 1) id = paths[0];
    else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      if (parsed.pathname === "/watch") id = parsed.searchParams.get("v");
      else if (paths.length === 2 && ["embed", "shorts", "live"].includes(paths[0])) id = paths[1];
    } else if (
      ["youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host) &&
      paths.length === 2 &&
      paths[0] === "embed"
    )
      id = paths[1];
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
    const rawTime =
      parsed.searchParams.get("t") ??
      parsed.searchParams.get("start") ??
      new URLSearchParams(parsed.hash.slice(1)).get("t") ??
      "0";
    const duration = rawTime.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    const seconds = /^\d+$/.test(rawTime)
      ? Number(rawTime)
      : duration
        ? Number(duration[1] ?? 0) * 3600 + Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0)
        : 0;
    const start = startMs != null && Number.isFinite(startMs) ? startMs / 1000 : seconds;
    return { id, start: Math.max(0, Math.min(2147483647, Math.floor(start))) };
  } catch {
    return null;
  }
}
