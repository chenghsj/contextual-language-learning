import { CustomAgentImportSchema, type CustomAgentImport } from "@immersive/core";

export const AGENT_CONFIG_PROMPT = "You are configuring YOUR OWN installed CLI Agent for Immersive Language Learning. Determine the actual executable and non-interactive command from your current --help or official CLI documentation; do not invent flags. Output exactly ONE JSON object with no explanations, Markdown fences, credentials, shell commands or generated id. Required: {\"label\":\"Agent name\",\"executable\":\"one executable name or absolute path\",\"args\":[\"each\",\"argument\",\"separately\"],\"promptMode\":\"argument or stdin\",\"outputMode\":\"stdout-json or file-json\"}. Optional: \"modelArgument\" (one real flag), \"modelListArgs\" (string array of real supported arguments), and \"profileEnvVar\" (a verified configuration-directory environment variable, not a password/token). For argument mode args MUST include literal {prompt} and for stdin mode it MUST NOT; include the CLI's real stdin flag (such as documented '-') if needed. For file-json mode args MUST contain {output} where the final JSON output path is required; stdout-json MUST NOT contain {output}. A JSONL event stream is not a single stdout-json result. Prefer read-only/no-side-effect execution flags where supported. The CLI must produce a single JSON object as its final response, without Markdown fences. Never include API keys, tokens, login details, shell operators, pipes or unverified model/profile flags. If you cannot verify the required non-interactive input and single JSON output, output only {\"error\":\"Cannot verify CLI configuration\",\"missing\":[\"specific missing information\"]}.";

/** Accept one JSON object, optionally wrapped in a JSON code fence. Never evaluate AI text. */
export function parseAgentImport(text: string): CustomAgentImport {
  if (text.length > 32_000) throw new Error("Agent configuration JSON is too large.");
  const raw = text.trim()
    .replace(/^\x60{3}(?:json)?\s*\r?\n/i, "")
    .replace(/\r?\n\x60{3}\s*$/, "").trim();
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { throw new Error("Paste a single valid JSON object without explanations."); }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      "error" in parsed && typeof parsed.error === "string") {
    throw new Error(parsed.error);
  }
  const result = CustomAgentImportSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error((first.path.length ? first.path.join(".") + ": " : "") + first.message);
  }
  return result.data;
}

export function jsonForEdit(value: CustomAgentImport): string {
  return JSON.stringify(value, null, 2);
}
