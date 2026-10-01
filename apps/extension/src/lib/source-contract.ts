import { readFile } from "node:fs/promises";

/** Static wiring/style checks ignore layout added by the formatter. Runtime flows have interface tests. */
export async function readSource(path: URL, _encoding: "utf8" = "utf8"): Promise<string> {
  const source = await readFile(path, "utf8");
  return source
    .replace(/\s+/g, " ")
    .replace(/,\s*([}\])])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\./g, ".")
    .replace(/(?<!=)>\s+\{/g, ">{")
    .replace(/\}\s+</g, "}<")
    .replace(/\s+\)/g, ")")
    .replace(/=\{\s+/g, "={")
    .replace(/&& \((?=<)/g, "&& ")
    .replace(/(<\/[A-Za-z][^>]*>|\/>|\))\s+\}/g, "$1}");
}
