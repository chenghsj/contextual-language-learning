import { CustomAgentImportSchema, type CustomAgentImport } from "@immersive/core";

export const AGENT_CONFIG_PROMPT = "You are configuring the CLI Agent currently running this conversation\nfor the Immersive Language Learning Chrome extension.\n\nThis is a configuration-only task. Do not execute commands, use tools,\ninspect files, browse documentation, or test the CLI. Use only CLI\narguments you already know. Do not guess unknown options.\n\nReturn exactly one JSON object with these required fields:\n\n{\n  \"label\": \"Your CLI Agent name\",\n  \"executable\": \"your-cli\",\n  \"args\": [\"{prompt}\"],\n  \"promptMode\": \"argument\",\n  \"outputMode\": \"stdout-json\"\n}\n\nReplace the example values with your actual CLI configuration.\nThe args array is an example of the required format, not a complete\ncommand for your CLI.\n\nRules:\n- executable: One CLI executable name or absolute path.\n- args: Separate command-line arguments, not a shell command.\n- promptMode: \"argument\" or \"stdin\". Use {prompt} in args only\n  for argument mode.\n- outputMode: \"stdout-json\" or \"file-json\". This describes how the\n  extension receives the FINAL assistant response, not every CLI event.\n- stdout-json: stdout must contain one parseable JSON object with\n  the final response. A JSONL event stream alone is not supported.\n- file-json: the CLI writes its final assistant message to the file\n  specified by {output}. Include {output} in args only for this mode.\n  A CLI option that saves the last assistant message qualifies.\n- The extension will request JSON from the model and validate the\n  final response. You do not need to guarantee that every future\n  model response will be valid JSON.\n\nInclude these optional fields ONLY if you know they are supported:\n- modelArgument: CLI flag for selecting a model.\n- modelListArgs: Array of arguments for listing available models.\n- profileEnvVar: Environment variable for the CLI configuration directory.\n\nDo not include an id, credentials, tokens, passwords, shell operators,\nunknown fields, or unsupported arguments.\n\nIf you cannot determine the required executable, non-interactive\nprompt transport, or final-response output transport, return:\n\n{\n  \"error\": \"Cannot verify CLI configuration\",\n  \"missing\": [\"specific required information you do not know\"]\n}\n\nOutput only the JSON object. No Markdown, explanation, or tool calls.";

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
