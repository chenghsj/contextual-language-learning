import { readSource } from "../lib/source-contract";
import ts from "typescript";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Reference: integration commit 7b9249afa90dea8d5d2b525660c7dea26b9ecefc,
 * before the PR #69/#71 UI refactors. Hashes are derived from that commit's
 * className attributes and cva definitions, not unrelated protocol strings.
 * Button motion intentionally uses transition-shadow; its other styles and variants
 * retain the reference values.
 * A future intentional shadcn upgrade must be reviewed separately.
 */
const originalStyleHashes = {
  "badge.tsx": "5607e8c5e08f644c2c9a0bbced126794f30287ba456900cc126fb0bd9022e3f6",
  "button.tsx": "fecbfe6295b3e0c3b3d1f74d1f56396c5d4d071faa500aff2c906146b3331d9a",
  "card.tsx": "dbc4f91fba0284d9588e8f141109d5fcdc9a6650a0e5527069c2396a79a7ff39",
  "input.tsx": "4d50f69622595a1b94deca54cd6118d12904c116e19ed9172f3c535cd9eb4ffe",
  "select.tsx": "095b9c53f08dfc1281b4dfe8c6cca4344ce69044e2de9f8104ceeadf26a33c2f",
  "textarea.tsx": "862271426615a24f0a8a11d404f1f7b235c06478a2d96ee91be4cbd2cba642ed",
} as const;

function styleHash(source: string): string {
  const tree = ts.createSourceFile(
    "wrapper.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const strings: string[] = [];
  function collectStrings(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) strings.push(node.text);
    ts.forEachChild(node, collectStrings);
  }
  function visit(node: ts.Node) {
    if (
      (ts.isJsxAttribute(node) && node.name.getText(tree) === "className") ||
      (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "cva")
    )
      collectStrings(node);
    else ts.forEachChild(node, visit);
  }
  visit(tree);
  return createHash("sha256").update(JSON.stringify(strings)).digest("hex");
}

test("style hashes ignore Select identifiers while detecting class and variant changes", async () => {
  const select = await readFile(
    new URL("../../../../packages/ui/src/components/ui/select.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    styleHash(select.replaceAll("__contextual_default_select_option__", "__renamed_option__")),
    styleHash(select),
  );
  assert.notEqual(
    styleHash(select.replace("flex h-9 w-full", "flex h-10 w-full")),
    styleHash(select),
  );
  const button = await readFile(
    new URL("../../../../packages/ui/src/components/ui/button.tsx", import.meta.url),
    "utf8",
  );
  assert.notEqual(
    styleHash(button.replace('default: "h-9 px-4 py-2"', 'default: "h-10 px-4 py-2"')),
    styleHash(button),
  );
});

test("all six shared shadcn wrappers retain their original styles and variants", async () => {
  for (const [file, expectedSha] of Object.entries(originalStyleHashes)) {
    const source = await readFile(
      new URL(
        file === "textarea.tsx"
          ? "../components/ui/" + file
          : "../../../../packages/ui/src/components/ui/" + file,
        import.meta.url,
      ),
      "utf8",
    );
    assert.equal(
      styleHash(source),
      expectedSha,
      file + " must retain the pre-refactor style and variant strings",
    );
  }
});

test("application-specific Card layout stays outside the shadcn Card", async () => {
  const panel = await readSource(new URL("../components/app-panel.tsx", import.meta.url));
  const app = await readSource(new URL("../App.tsx", import.meta.url));
  const contextual = await readSource(
    new URL("../components/contextual-scene-reader.tsx", import.meta.url),
  );
  assert.match(panel, /<Card\s/);
  assert.match(panel, /mb-3 min-w-0 max-w-full p-4/);
  assert.doesNotMatch(
    panel,
    /(?:bg-card|shadow-|rounded-|border-border)/,
    "AppPanel should add spacing/heading layout, not override the shadcn Card's appearance",
  );
  assert.match(app, /<AppPanel>/);
  assert.match(contextual, /data-ui="unifiedReader"/);
  const importing = await readSource(new URL("../components/subtitle-import.tsx", import.meta.url));
  assert.match(importing, /<Input ref=\{fileInput\} type="file" className="hidden"/);
  assert.match(importing, /<Textarea id=\{pasteId\} className="resize-y" rows=\{5\}/);
  assert.doesNotMatch(
    app,
    /<Button variant="outline" className="bg-secondary/,
    "the original shadcn outline variant must not be recolored by page CSS",
  );
});
