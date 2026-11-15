import { parseAgentJson } from "../agents/json";

/** Repair observed lexical typos outside strings; schema/source validation remains mandatory. */
export function parseCompactJson(text: string): { value: unknown; repairs: string[] } {
  try {
    return { value: parseAgentJson(text, "Pi"), repairs: [] };
  } catch (original) {
    const trimmed = text.replace(/^\uFEFF/, "").trim();
    const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
    const source = fenced ? fenced[1] : trimmed;
    let output = "",
      inside = false,
      escaped = false;
    const repairs = new Set<string>();
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (inside) {
        output += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inside = false;
        continue;
      }
      if (
        char === "\\" &&
        output.trimEnd().endsWith("{") &&
        /^[ \t]*\r?\n/.test(source.slice(i + 1))
      ) {
        repairs.add("stray_object_backslash");
        continue;
      }
      if (char === "r" && /[{,]\s*$/.test(output) && /^reading\s*:/.test(source.slice(i))) {
        output += '"reading"';
        i += "reading".length - 1;
        repairs.add("unquoted_reading_key");
        continue;
      }
      if (char === '"') {
        if (/[{,]\s*$/.test(output) && /^"targetLineIndex(?=\s*:\s*\d)/.test(source.slice(i))) {
          output += '"targetLineIndex"';
          i += '"targetLineIndex'.length - 1;
          repairs.add("target_line_index_key_quote");
          continue;
        }
        if (
          /"(?:start|end)"\s*:\s*\d+\s*$/.test(output.slice(-120)) &&
          /^\s*[,}\]]/.test(source.slice(i + 1))
        ) {
          repairs.add("span_number_quote");
          continue;
        }
        inside = true;
      }
      output += char;
    }
    if (!repairs.size) throw original;
    try {
      return { value: JSON.parse(output) as unknown, repairs: [...repairs] };
    } catch {
      throw original;
    }
  }
}
