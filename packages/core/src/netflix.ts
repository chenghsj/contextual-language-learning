export function netflixWatchId(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["netflix.com", "www.netflix.com"].includes(url.hostname.toLowerCase())
    )
      return null;
    const match = url.pathname.match(/^\/watch\/(\d+)(?:\/|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
