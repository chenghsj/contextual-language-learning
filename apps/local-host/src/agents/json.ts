/**
 * CLI envelopes are JSON, but their message fields can contain a
 * Markdown-wrapped JSON reply even when the prompt requests raw JSON.
 * Accept only a complete JSON value or ONE complete JSON code block.
 * Never scrape a partial object out of prose. The pipeline validates schemas.
 */
export function parseAgentJson(value: unknown, provider: string): unknown {
  if (typeof value !== "string") return value;
  const text = value.replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Reject extra commentary, multiple blocks, malformed JSON and other tags.
    const fenced = /^\x60{3}(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n\x60{3}$/i.exec(text);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim()) as unknown;
      } catch { /* Fall through to an actionable error. */ }
    }
    throw new Error(
      provider + " returned invalid lesson JSON. " +
      "The model must return one JSON object (a JSON code block is also supported). " +
      "Use Resume in task history to retry from the saved checkpoint.",
    );
  }
}
