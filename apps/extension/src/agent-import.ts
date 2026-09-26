import { CustomAgentImportSchema, type CustomAgentImport } from "@immersive/core";

export const AGENT_CONFIG_PROMPT = "You are preparing a CLI Agent configuration for the Immersive Language Learning Chrome extension. This is a JSON FORMATTING TASK ONLY.\n\nDo NOT use tools, run shell commands, inspect files or environment variables, browse the web, read documentation or --help, search the workspace, test the CLI, call another Agent, or change anything. Use ONLY CLI syntax you already know with confidence. Do not execute anything.\n\nThe extension supplies each generation prompt, asks the model to return JSON, and validates the final reply. You are configuring the CLI's transport, NOT guaranteeing that every future model response will be valid JSON. A CLI can print progress to stderr. A CLI flag that writes its LAST ASSISTANT MESSAGE to a file qualifies as \"file-json\" when the prompted final message is JSON. Do not confuse the CLI's JSONL EVENT STREAM (for example Codex \"exec --json\") with the model's final JSON answer.\n\nIf YOU ARE Codex CLI, use this documented non-interactive configuration (do not run it):\n{\n  \"label\": \"Codex CLI\",\n  \"executable\": \"codex\",\n  \"args\": [\"exec\", \"--sandbox\", \"read-only\", \"--skip-git-repo-check\", \"--output-last-message\", \"{output}\", \"-\"],\n  \"promptMode\": \"stdin\",\n  \"outputMode\": \"file-json\",\n  \"modelArgument\": \"--model\",\n  \"profileEnvVar\": \"CODEX_HOME\"\n}\nFor Codex, \"-\" reads the extension's prompt from stdin and --output-last-message writes the final assistant message to the Host's {output} file. Do not add \"--json\": that produces JSONL events instead of a single final JSON document. The Host will read the file and validate the response. Do not invent \"modelListArgs\" for Codex.\n\nFor any OTHER CLI, return exactly ONE JSON object using these REQUIRED keys and types:\n{\n  \"label\": \"Your CLI Agent name\",\n  \"executable\": \"your-cli\",\n  \"args\": [\"{prompt}\"],\n  \"promptMode\": \"argument\",\n  \"outputMode\": \"stdout-json\"\n}\nReplace example values with your real non-interactive invocation: \"executable\" is one executable name or absolute path; \"args\" is an array of separate argv strings, not a shell command.\n- \"promptMode\" is \"argument\" or \"stdin\". For \"argument\", include the literal {prompt} exactly where the model prompt goes. For \"stdin\", omit {prompt} from args; include a stdin marker such as \"-\" ONLY if the CLI requires it.\n- \"outputMode\" is \"stdout-json\" or \"file-json\". For \"stdout-json\", the final model message is written to stdout and must contain the requested JSON object; do not choose it for stdout JSONL event streams. For \"file-json\", include literal {output} in args where the CLI writes its final model message; omit {output} for stdout-json. The extension checks that the resulting message is valid JSON.\n- Only when known, add OPTIONAL \"modelArgument\" (one model flag), \"modelListArgs\" (real model-list argv array), or \"profileEnvVar\" (real CLI configuration-directory environment variable, not a credential). Omit unknown optional fields; never use null.\n- Do NOT include an id, credentials, API keys, tokens, passwords, shell operators, pipe/redirection commands, invented flags, unknown keys, or explanations. The extension creates the id and executes argv directly without a shell.\n\nIf you do not know the real executable, non-interactive prompt transport, or how to obtain the FINAL model message through stdout or a file, return exactly:\n{\n  \"error\": \"Cannot verify CLI configuration\",\n  \"missing\": [\"name of each required detail you do not know\"]\n}\n\nOutput ONLY the single JSON object matching your CLI. Do not use Markdown code fences, comments, explanations or surrounding text. Do not execute anything.";

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
