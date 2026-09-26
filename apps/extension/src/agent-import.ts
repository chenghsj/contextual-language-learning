import { CustomAgentImportSchema, type CustomAgentImport } from "@immersive/core";

export const AGENT_CONFIG_PROMPT = "You are preparing a CLI Agent configuration for the Immersive Language Learning Chrome extension. This is a JSON FORMATTING TASK ONLY.\n\nDo NOT use tools, run shell commands, inspect files or environment variables, browse the web, read documentation or --help, search the workspace, test the CLI, call another Agent, or change anything. Use ONLY CLI syntax you already know with confidence. If a required option is unknown, return the error JSON below immediately; do not investigate or guess.\n\nReturn exactly ONE valid JSON object using these REQUIRED keys and types:\n{\n  \"label\": \"Your CLI Agent name\",\n  \"executable\": \"your-cli\",\n  \"args\": [\"{prompt}\"],\n  \"promptMode\": \"argument\",\n  \"outputMode\": \"stdout-json\"\n}\n\nReplace every example value with your real CLI configuration; the args array above is only a shape example, NOT a claim that your CLI needs no other flags. Include all actual arguments needed for a NON-INTERACTIVE invocation. \"executable\" is one executable name or absolute path (not a command string). \"args\" is an array of separate argv strings, not one shell command.\n\nRules for the REQUIRED modes:\n- \"promptMode\" must be \"argument\" or \"stdin\". For \"argument\", put the literal {prompt} in args where the user's prompt goes. For \"stdin\", do NOT put {prompt} in args; add a CLI-specific stdin marker (such as \"-\") ONLY if you know your CLI requires it.\n- \"outputMode\" must be \"stdout-json\" or \"file-json\". For \"stdout-json\", the CLI must write ONE final JSON object to stdout; JSONL/event streams are NOT valid. For \"file-json\", put the literal {output} in args where the CLI writes its final JSON output file. Do not include {output} for stdout-json.\n- Add ONLY these OPTIONAL keys when you know they are supported: \"modelArgument\" (one CLI model flag, e.g. \"--model\"), \"modelListArgs\" (array of actual model-list argv strings), \"profileEnvVar\" (a verified CLI configuration-directory environment variable, not a credential). Omit unknown optional fields; do not use null.\n- Do NOT include an id, credentials, API keys, access tokens, passwords, login details, shell operators, pipe/redirection commands, invented flags, unknown keys, or explanatory fields. The extension generates the id and runs argv directly, without a shell.\n\nIf you cannot confidently provide the real executable, non-interactive invocation or a single final JSON output mode, return exactly:\n{\n  \"error\": \"Cannot verify CLI configuration\",\n  \"missing\": [\"name of each required detail you do not know\"]\n}\n\nOutput ONLY the single JSON object. Do not use Markdown code fences, comments, explanation or surrounding text. Do not execute anything.";

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
